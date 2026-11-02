// 一括実行の計画（純関数）。サーバー（api/batch/_batchLogic.ts）と画面（App の構成・結果欄の判定・ノードの対象表示）が同じ関数を使う。
// 設計: docs/specs/product-video-nodes.md §5
// - 写真（SKU）ごとに動くノード: Remove Background / Image Generation（画像入力あり）/ Video Generation / Video Merge（結合は AI 段に数えない）
// - 入力の出どころ: Batch Input（写真）、Cut Set Input（役割のカット・カット一式）、前段の AI ノード（結果ノード経由は透過）
// - 入口は Batch Input だけ（2026-11-01: Cut Set Input・旧 Product Video・動画の一括処理は廃止。旧 cut / set の参照は保存済みタスクの読み取り用に型だけ残す）
// - 動画タスクが 1 つでもあれば、動画につながらない画像のタスクは対象外（2026-10-31 決定）
import { buildEngineRequest, normalizeCutoutParams } from '../cutout/engines'
import { buildImageEditRequest, buildTextToImageInput, editModelOf } from '../ai/imageGenModels'
import { backgroundSourcesOf, promptForGenerator } from './background'
import { buildVideoInput, resolveAspectRatio, resolveSafeDuration, resolveSafeFps, videoModelById } from '../ai/videoModels'
import type { VideoGenerationRequest, VideoModelDefinition } from '../ai/types'
import { CUT_ROLES, CUT_ROLE_LABEL, END_CUT_CFG_SCALE, FRONTAL_ROLE, MERGE_VIDEOS_ENDPOINT, builtinEnglish, cutOf, hasTurnPreset, turnPreset, withTurnMotion, withTurnNegative, type CutRole, type ItemCut } from '../video/productVideo'
import { textsNeedingTranslation } from '../video/translate'
import { TRY_ON_ENDPOINT, TRY_ON_GARMENT_HANDLE, TRY_ON_MODEL_HANDLE, buildTryOnInput, isCutRole, normalizeTryOnParams, tryOnPromptFromNote } from '../tryon/prompt'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SnapshotNode { id: string; type?: string; data?: any; position?: { x: number; y: number } }
export interface SnapshotEdge { id?: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }
/** promptTranslations: 日本語のプロンプト → 英語（create で作って写しに添える。submit の計画が使う） */
export interface WorkflowSnapshot { nodes?: SnapshotNode[]; edges?: SnapshotEdge[]; promptTranslations?: Record<string, string> }

export type PlannedKind = 'cutout' | 'imageGen' | 'imageEdit' | 'videoShot' | 'videoMerge'
/** タスクの入力の出どころ（投入時に buildTaskInput が解決する。§5.2） */
export type InputRef =
  | { kind: 'photo' }                                            // Batch Input の写真（item.source_path）
  | { kind: 'cut'; role: CutRole }                               // 旧 Cut Set Input の役割カット（保存済みタスクの読み取り用・新規には作らない）
  | { kind: 'set' }                                              // 旧 カット一式（同上）
  | { kind: 'dep'; nodeId: string; prefer: 'cutout' | 'result'; role?: CutRole } // 前段の結果（切り抜きは透過画像 cutout_path を優先）。role = その画像の向き（Try-On のモデルの向き。回転指示に使う）
  | { kind: 'asset'; url: string; role?: CutRole }               // 固定の画像（Try-On のモデル・Model ノードのカット・参照画像・結果ノードの画像。全アイテム共通。作成時に権限を確かめ、投入時にサーバーが署名）。role = その画像の向き
/** model: 試着のモデル画像（image = 服）。image_urls は [モデル, 服] の順 */
export interface TaskInputs { image?: InputRef; model?: InputRef; start?: InputRef; end?: InputRef; elements?: { kind: 'set' }; videos?: string[] }
/** 動画タスクの投入時に URL を置く場所（モデルごとに違う） */
export interface VideoTaskMeta { modelId: string; startParam: string; endParam: string | null; elements: boolean; aspectAuto: boolean; aspectRatios: string[] }
export interface PlannedTask {
  nodeId: string
  scope: 'item' | 'job'
  endpoint: string
  input: Record<string, unknown>   // アイテムごとのタスクは URL（image_url / start_image_url / video_urls …）を投入時に足す
  kind: PlannedKind
  stage: number                    // アイテムごと: 1 = 元の写真を入力、2 = 1 段目の結果を入力（結合は前段 + 1）。ジョブごとは 1
  dependsOn: string | string[] | null   // 待つ前段のノード id（1 つなら文字列・複数なら配列。結合は複数）
  label: string                    // ノード名（見積の内訳・結果タブ）
  dualOutput: boolean              // 切り抜き: マスクと透過画像の両方を受け取る（後段が切り抜き画像を使う）
  inputs: TaskInputs
  terminal: boolean                // 動画: 終端（この先に結合が無い）= 結果欄・ライブラリに出す 1 本
  video: VideoTaskMeta | null
}
export const MAX_ITEM_STAGES = 2

// ───────────────────────── ハンドル名 ─────────────────────────
export const cutSetRoleHandle = (role: CutRole): string => `out-image-${role}`
export const cutSetRoleOfHandle = (handle: string | null | undefined): CutRole | null => {
  const m = /^out-image-([a-z]+)$/.exec(handle ?? '')
  const role = m?.[1]
  return role && CUT_ROLES.some((r) => r.id === role) ? (role as CutRole) : null
}
export const VIDEO_GEN_START_HANDLE = 'in-image'
export const VIDEO_GEN_END_HANDLE = 'in-image-end'
export const VIDEO_GEN_TEXT_HANDLES = ['in-text', 'in-text-prompt']
export const VIDEO_OUTPUT_HANDLE = 'out-video'
/** 参照の向き（役割カットはその役割、前段の結果は載っている向き）。回転指示・ショットの見出しに使う */
export const roleOfRef = (ref: InputRef | null | undefined): CutRole | null => (ref?.kind === 'cut' ? ref.role : ref?.kind === 'dep' || ref?.kind === 'asset' ? ref.role ?? null : null)
export const VIDEO_MERGE_MAX_INPUTS = 8
export const videoMergeSlotHandle = (n: number): string => `in-video-${n}`
export const videoMergeSlotOf = (handle: string | null | undefined): number | null => {
  const m = /^in-video-(\d+)$/.exec(handle ?? '')
  return m ? Number(m[1]) : null
}
export const REMOVE_BACKGROUND_INPUT = 'in-image-image'

// ───────────────────────── ノードの種類 ─────────────────────────
// data.type が無いノード（Video Generation など）は React Flow のノード型から引く
const RF_TYPE_TO_KIND: Record<string, string> = {
  videoGenerationNode: 'videoGen', videoDisplayNode: 'videoDisplay', videoMergeNode: 'videoMerge', referenceVideoNode: 'referenceVideo',
  imageDisplayNode: 'imageDisplay', textPromptNode: 'textPrompt', referenceImageNode: 'referenceImage', batchInputNode: 'batchInput',
  removeBackgroundNode: 'removeBackground', productLayoutNode: 'productLayout', imageGenerationNode: 'imageGen', exportNode: 'export', tryOnNode: 'tryOn', libraryModelNode: 'libraryModel',
  klingElementNode: 'klingElement',
}
export function nodeKindOf(n: SnapshotNode | null | undefined): string | undefined {
  const t = n?.data?.type
  if (typeof t === 'string' && t) return t
  return n?.type ? RF_TYPE_TO_KIND[n.type] : undefined
}

/** Try-On の画像の向き: モデル入力が Cut Set Input の役割ポートならその役割、別の Try-On（またはその結果ノード）なら同じ向き、配線が無ければノード内で選んだカットの向き */
function tryOnRoleOf(nodes: SnapshotNode[], edges: SnapshotEdge[], nodeId: string, seen: Set<string> = new Set()): CutRole | null {
  if (seen.has(nodeId)) return null
  seen.add(nodeId)
  const e = edges.find((x) => x.target === nodeId && x.targetHandle === TRY_ON_MODEL_HANDLE)
  if (e) return imageRoleOfSource(nodes, edges, e.source, e.sourceHandle, seen)
  const d = nodes.find((n) => n.id === nodeId)?.data
  const r = d?.model?.role
  if (isCutRole(r)) return r
  const planned = d?.params?.role   // 向きの予定（テンプレートが付ける）
  return isCutRole(planned) ? planned : null
}
/** 画像の出どころの向き（キャンバスでも写しでも使える純関数）: Cut Set Input / Model ノードの役割ポート、モデルタブから入れた参照画像、Try-On（とその結果ノード）。それ以外は null */
export function imageRoleOfSource(nodes: SnapshotNode[], edges: SnapshotEdge[], sourceId: string, sourceHandle: string | null | undefined, seen: Set<string> = new Set()): CutRole | null {
  const src = nodes.find((n) => n.id === sourceId)
  const k = nodeKindOf(src)
  if (k === 'libraryModel') return cutSetRoleOfHandle(sourceHandle)   // Model ノードの向きのポート
  // 参照画像の向きは読まない（2026-11-02 メモ 42: Reference Image の「向き」とモデルタブの見えない向きを廃止。回転の指示文はテンプレート・チャットが組むときに欄へ書く）
  if (k === 'tryOn') return tryOnRoleOf(nodes, edges, sourceId, seen)
  if (k === 'imageDisplay') {
    const feed = edges.find((e) => e.target === sourceId && nodeKindOf(nodes.find((n) => n.id === e.source)) === 'tryOn')
    return feed ? tryOnRoleOf(nodes, edges, feed.source, seen) : null
  }
  return null
}
const DEFAULT_LABELS: Record<string, string> = { removeBackground: 'Remove Background', imageGen: 'Image Generation', videoGen: 'Video Generation', videoMerge: 'Video Merge', tryOn: 'Try-On', libraryModel: 'Model' }
export function nodeLabelOf(n: SnapshotNode | null | undefined): string {
  const l = n?.data?.label
  return typeof l === 'string' && l.trim() ? l.trim() : (DEFAULT_LABELS[nodeKindOf(n) ?? ''] ?? n?.id ?? '')
}
const nodesOf = (s: WorkflowSnapshot | null | undefined): SnapshotNode[] => (Array.isArray(s?.nodes) ? s!.nodes!.filter((n) => !!n && typeof n.id === 'string') : [])
const edgesOf = (s: WorkflowSnapshot | null | undefined): SnapshotEdge[] => (Array.isArray(s?.edges) ? s!.edges!.filter((e) => !!e && typeof e.source === 'string' && typeof e.target === 'string') : [])

// ───────────────────────── 旧 Product Video ノードの展開（§7） ─────────────────────────
export const PRODUCT_VIDEO_DEFAULT_MODEL = 'kling-v3-pro'

/** 写しの入口（Batch Input）。一括実行の対象を決める */
export function inputNodesOf(snapshot: WorkflowSnapshot | null | undefined): { batchInputId: string | null } {
  const nodes = nodesOf(snapshot)
  return {
    batchInputId: nodes.find((n) => nodeKindOf(n) === 'batchInput')?.id ?? null,
  }
}

/** 入口ノード（Batch Input / Cut Set Input）が複数あるキャンバスで、押した入口の枝だけを残す（他の入口ノードとその辺を外す）。
 *  一括実行はどの入口から押したかで対象が決まる（2026-11-01 メモ 24: 両方あると Cut Set Input の判定と動画ジョブ判定が混ざって 400 になった）。入口が 1 つ以下ならそのまま */
export function pruneToEntry<T extends WorkflowSnapshot | null | undefined>(snapshot: T, entryNodeId: string | null | undefined): T {
  if (!snapshot || !entryNodeId) return snapshot
  const snap = snapshot as WorkflowSnapshot
  const nodes = nodesOf(snap)
  const drop = new Set(nodes.filter((n) => n.id !== entryNodeId && nodeKindOf(n) === 'batchInput').map((n) => n.id))
  if (!drop.size) return snapshot
  return { ...snap, nodes: nodes.filter((n) => !drop.has(n.id)), edges: edgesOf(snap).filter((e) => !drop.has(e.source) && !drop.has(e.target)) } as T
}
/** ノードが行き着く入口（上流をたどって最初に見つかる Batch Input / Cut Set Input）。無ければ null */
export function entryNodeOf(snapshot: WorkflowSnapshot | null | undefined, nodeId: string): string | null {
  const snap = snapshot
  const nodes = nodesOf(snap), edges = edgesOf(snap)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  let frontier = [nodeId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      const k = nodeKindOf(byId.get(id))
      if (id !== nodeId && k === 'batchInput') return id
      for (const e of edges) if (e.target === id) next.push(e.source)
    }
    frontier = next
  }
  return null
}
/** ノードの表示用: そのノードの入口の枝だけで計画を立てる（別の入口の枝の動画タスクに引きずられない） */
export function planTasksForNode(snapshot: WorkflowSnapshot | null | undefined, nodeId: string): ReturnType<typeof planTasks> {
  return planTasks(pruneToEntry(snapshot, entryNodeOf(snapshot, nodeId)))
}

// ───────────────────────── プロンプト ─────────────────────────
const translator = (map: Record<string, string> | null | undefined) => (text: string): string => {
  const t = text.trim()
  return map?.[t] ?? builtinEnglish(t) ?? t
}
/** ノードの in-text につないだ Text Prompt / Prompt Enhancer の文（辺の順） */
function textsInto(nodes: SnapshotNode[], edges: SnapshotEdge[], nodeId: string): string[] {
  return edges
    .filter((e) => e.target === nodeId && VIDEO_GEN_TEXT_HANDLES.includes(e.targetHandle ?? ''))
    .map((e) => {
      const d = nodes.find((n) => n.id === e.source)?.data
      const p = d?.params?.prompt
      if (typeof p === 'string' && p.trim()) return p.trim()
      const out = d?.outputText
      return typeof out === 'string' && out.trim() ? out.trim() : null
    })
    .filter((t): t is string => !!t)
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** 「動き」は行ごとに訳す（回転の定型文 + 補足 のとき、定型文は対訳・補足だけ LLM）。空行は捨てて 1 行に */
const splitLines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean)
const trLines = (tr: (t: string) => string, text: string): string => splitLines(text).map(tr).join(' ')

/** Video Generation のプロンプトと negative（§4.2）。指示は欄に見える文だけ（回転の定型文も欄に入れる。裏で足さない・2026-11-01 決定）。終点があるショットは cfg を強める */
export function videoPromptOf(nodes: SnapshotNode[], edges: SnapshotEdge[], node: SnapshotNode, inputs: TaskInputs, translations: Record<string, string> | null | undefined): { prompt: string; negative: string; turned: boolean } {
  const tr = translator(translations)
  const p = (node.data?.params ?? {}) as Record<string, unknown>
  const base = textsInto(nodes, edges, node.id).map(tr).join('\n\n')
  const own = trLines(tr, str(p.prompt))
  const prompt = `${base ? base + '\n' : ''}${own}`.trim()   // 参照一式の @ElementN も「動き」の欄に見える形で書く（裏で足さない・2026-11-02 メモ 42）
  const negative = tr(str(p.negativePrompt))
  return { prompt, negative, turned: !!inputs.end }   // 終点があるショットは指示への追従を強める（cfg・欄で変えられる）
}

/** ジョブ作成時に英訳が要る文（計画対象の Video Generation の動き・避けたいこと・つないだテキスト、Try-On の服の説明・補足のうち日本語で対訳の無いもの） */
export function promptTextsToTranslateForPlan(snapshot: WorkflowSnapshot | null | undefined): string[] {
  const snap = snapshot
  const nodes = nodesOf(snap), edges = edgesOf(snap)
  const { tasks } = planTasks(snap)
  const videoTexts = tasks.filter((t) => t.kind === 'videoShot').flatMap((t) => videoPromptSources(nodes, edges, t.nodeId, t.inputs))
  // 試着の「服の説明・補足」（日本語なら英訳して既定文に差し込む）
  const tryOnNotes = tasks.map((t) => nodes.find((n) => n.id === t.nodeId)).filter((n) => nodeKindOf(n) === 'tryOn').map((n) => normalizeTryOnParams(n?.data?.params).note)
  return textsNeedingTranslation([...videoTexts, ...tryOnNotes])
}

/** Video Generation のプロンプトの素（翻訳の対象）: 動き（回転指示が付くときの静止用定型文は除く）・避けたいこと・つないだテキスト */
export function videoPromptSources(nodes: SnapshotNode[], edges: SnapshotEdge[], nodeId: string, _inputs?: TaskInputs): string[] {
  const node = nodes.find((n) => n.id === nodeId)
  const p = (node?.data?.params ?? {}) as Record<string, unknown>
  return [...splitLines(str(p.prompt)), str(p.negativePrompt), ...textsInto(nodes, edges, nodeId)]
}

/** 保存済みのワークフローを開いたとき / 組んだ直後に、Video Generation の回転の定型文を欄に書き込む（2026-11-01・「回転の指示を自動で付ける」トグルの廃止）。
 *  トグル時代の既定（autoTurn 未設定 = 自動で付く）だったノードは、始点と終点の向きが分かっていれば autoTurn: false にし、向きが違って動きに定型文が無ければ定型文を「動き」と「避けたいこと」に入れる（生成される指示は同じ内容）。
 *  向きが分からないノードはそのまま（計画の旧互換で自動が効く）。autoTurn: false のノードは触らない。変更が無ければ nodes をそのまま返す */
export function materializeTurnPresets(nodes: SnapshotNode[], edges: SnapshotEdge[], roleHints?: Record<string, CutRole>): { nodes: SnapshotNode[]; changed: boolean; written: number } {
  let changed = false
  let written = 0
  const out = nodes.map((n) => {
    if (nodeKindOf(n) !== 'videoGen') return n
    const p = (n.data?.params ?? {}) as Record<string, unknown>
    if (p.autoTurn === false) return n
    const startEdge = edges.find((e) => e.target === n.id && e.targetHandle === VIDEO_GEN_START_HANDLE)
    const endEdge = edges.find((e) => e.target === n.id && e.targetHandle === VIDEO_GEN_END_HANDLE)
    // roleHints = チャットで組むときだけの参照画像の向き（ノードには残さない・2026-11-02 メモ 42）
    const startRole = startEdge ? imageRoleOfSource(nodes, edges, startEdge.source, startEdge.sourceHandle) ?? roleHints?.[startEdge.source] ?? null : null
    const endRole = endEdge ? imageRoleOfSource(nodes, edges, endEdge.source, endEdge.sourceHandle) ?? roleHints?.[endEdge.source] ?? null : null
    if (!startRole || !endRole) return n
    changed = true
    const prompt = str(p.prompt)
    if (startRole === endRole || hasTurnPreset(prompt)) return { ...n, data: { ...n.data, params: { ...p, autoTurn: false } } }
    const t = turnPreset(startRole, endRole)
    written++
    return { ...n, data: { ...n.data, params: { ...p, prompt: withTurnMotion(prompt, t.motion), negativePrompt: withTurnNegative(str(p.negativePrompt), t.negativeJp), autoTurn: false } } }
  })
  return { nodes: changed ? out : nodes, changed, written }
}

// ───────────────────────── 計画 ─────────────────────────
type Producer = { kind: 'input'; ref: InputRef } | { kind: 'fixed'; ref: InputRef } | { kind: 'ai'; nodeId: string; role?: CutRole | null } | { kind: 'other' }
type Analysis = { ok: true; inputs: TaskInputs; deps: string[]; aiDepth: number; stage: number; notes: string[] } | { ok: false; reason: 'not_connected' | 'upstream' | 'no_inputs' | 'no_garment' | 'no_model'; upstream?: string }

/**
 * 写しから AI 処理ノードを抽出する（仕様 4-2・フェーズ C・§5）。
 * - アイテムごと: Batch Input の写真 / Cut Set Input のカットに行き着く Remove Background / Image Generation（編集）/ Video Generation、
 *   それらを順に受ける Video Merge。AI 段は 1 経路 2 段まで（結合は数えない）
 * - ジョブごと: Product Layout の背景入力につながる Image Generation（executionScope='job'）1 件（Step 8）。動画があるジョブでは作らない
 */
export function planTasks(snapshot: WorkflowSnapshot | null | undefined): { tasks: PlannedTask[]; warnings: string[]; excluded: Record<string, string>; droppedForVideo: PlannedTask[]; emptyPrompt: string[] } {
  const snap = snapshot
  const nodes = nodesOf(snap), edges = edgesOf(snap)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kindOf = (id: string | undefined) => nodeKindOf(id ? byId.get(id) : undefined)
  // ノード名は種類名のままなので（2026-11-01）、Try-On は向きの予定を添えて区別する（注意文・結果の列名・{variant} に使う）
  const labelOf = (id: string | undefined) => {
    const n = id ? byId.get(id) : undefined
    const l = nodeLabelOf(n)
    if (nodeKindOf(n) === 'tryOn') { const r = normalizeTryOnParams(n?.data?.params).role; if (r) return `${l} ${CUT_ROLE_LABEL[r]}` }
    return l
  }
  const warnings: string[] = []
  const warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w) }
  const excluded: Record<string, string> = {}   // ノード id → 対象外の理由（ノードの表示用。注意文は名前で探さない）
  const exclude = (nodeId: string, w: string) => { excluded[nodeId] = w; warn(w) }
  const emptyPrompt: string[] = []   // 指示（プロンプト）が空で外した写真ごとの生成ノード（一括 App はこれがあると App にしない・2026-11-02）

  // 画像/動画の出どころ（結果ノードは透過して生成器へ）
  const producerOf = (sourceId: string, sourceHandle: string | null | undefined, want: 'image' | 'video'): Producer => {
    const k = kindOf(sourceId)
    if (want === 'image') {
      if (k === 'batchInput') return { kind: 'input', ref: { kind: 'photo' } }
      if (k === 'libraryModel') {
        // Model ノード: 役割ポートのカット = 固定の画像（向きつき）
        const role = cutSetRoleOfHandle(sourceHandle)
        const url = role ? byId.get(sourceId)?.data?.cuts?.[role]?.url : null
        return role && typeof url === 'string' && url ? { kind: 'fixed', ref: { kind: 'asset', url, role } } : { kind: 'other' }
      }
      if (k === 'referenceImage' || k === 'image') {
        // 参照画像: 固定の画像（写しでは output・キャンバスの生データでは imageUrl）。向きは持たない（2026-11-02 メモ 42）
        const d = byId.get(sourceId)?.data
        const url = typeof d?.output === 'string' && d.output ? d.output : typeof d?.imageUrl === 'string' && d.imageUrl && !d.imageUrl.startsWith('blob:') ? d.imageUrl : null
        return url ? { kind: 'fixed', ref: { kind: 'asset', url } } : { kind: 'other' }
      }
      if (k === 'removeBackground' || k === 'imageGen') return { kind: 'ai', nodeId: sourceId }
      if (k === 'tryOn') return { kind: 'ai', nodeId: sourceId, role: imageRoleOfSource(nodes, edges, sourceId, sourceHandle) }   // 試着の結果は向きを持つ（回転指示に使う）
      if (k === 'imageDisplay') {
        const feed = edges.find((e) => e.target === sourceId && (kindOf(e.source) === 'imageGen' || kindOf(e.source) === 'tryOn'))
        return feed ? { kind: 'ai', nodeId: feed.source, role: kindOf(feed.source) === 'tryOn' ? imageRoleOfSource(nodes, edges, sourceId, sourceHandle) : null } : { kind: 'other' }
      }
      return { kind: 'other' }
    }
    if (k === 'videoGen' || k === 'videoMerge') return { kind: 'ai', nodeId: sourceId }
    if (k === 'videoDisplay') {
      const feed = edges.find((e) => e.target === sourceId && (kindOf(e.source) === 'videoGen' || kindOf(e.source) === 'videoMerge'))
      return feed ? { kind: 'ai', nodeId: feed.source } : { kind: 'other' }
    }
    return { kind: 'other' }
  }
  const preferOf = (depId: string): 'cutout' | 'result' => (kindOf(depId) === 'removeBackground' ? 'cutout' : 'result')
  const refOf = (p: Producer): InputRef | null => (p.kind === 'input' || p.kind === 'fixed' ? p.ref : p.kind === 'ai' ? { kind: 'dep', nodeId: p.nodeId, prefer: preferOf(p.nodeId), ...(p.role ? { role: p.role } : {}) } : null)
  const isPerItemKind = (k: string | undefined) => k === 'removeBackground' || k === 'imageGen' || k === 'tryOn' || k === 'videoGen' || k === 'videoMerge'

  // 段の割り当てと入力の参照。メモ化して循環も止める
  const memo = new Map<string, Analysis | null>()
  const visiting = new Set<string>()
  const analyze = (nodeId: string): Analysis | null => {
    if (memo.has(nodeId)) return memo.get(nodeId)!
    if (visiting.has(nodeId)) return { ok: false, reason: 'not_connected' }
    visiting.add(nodeId)
    const r = analyzeInner(nodeId)
    visiting.delete(nodeId)
    memo.set(nodeId, r)
    return r
  }
  // 前段の参照をたどって深さを足す。前段が対象外なら自分も対象外
  const fold = (refs: InputRef[], notes: string[]): { ok: true; deps: string[]; aiDepth: number; stage: number } | { ok: false; upstream: string } => {
    const deps: string[] = []
    let aiDepth = 0, stage = 0
    for (const r of refs) {
      if (r.kind !== 'dep') continue
      const up = analyze(r.nodeId)
      if (!up || !up.ok) return { ok: false, upstream: r.nodeId }
      if (!deps.includes(r.nodeId)) deps.push(r.nodeId)
      aiDepth = Math.max(aiDepth, up.aiDepth); stage = Math.max(stage, up.stage); notes.push(...up.notes)
    }
    return { ok: true, deps, aiDepth, stage }
  }
  const analyzeInner = (nodeId: string): Analysis | null => {
    const node = byId.get(nodeId)
    const k = nodeKindOf(node)
    if (!node || !isPerItemKind(k)) return null
    const notes: string[] = []
    if (k === 'removeBackground') {
      const ins = edges.filter((e) => e.target === nodeId && e.targetHandle === REMOVE_BACKGROUND_INPUT)
      const ref = ins.length ? refOf(producerOf(ins[0].source, ins[0].sourceHandle, 'image')) : null
      if (!ref || ref.kind === 'asset') return { ok: false, reason: 'not_connected' }   // 固定の画像だけなら写真ごとの処理ではない
      const f = fold([ref], notes)
      if (!f.ok) return { ok: false, reason: 'upstream', upstream: f.upstream }
      return { ok: true, inputs: { image: ref }, deps: f.deps, aiDepth: f.aiDepth + 1, stage: f.stage + 1, notes }
    }
    if (k === 'imageGen') {
      // Image Generation は「一括実行のスコープ」に関わらず、写真由来の画像入力があれば写真ごと（スコープ「ジョブごと」は背景生成＝画像入力なしのときだけ意味を持つ）
      const ins = edges.filter((e) => e.target === nodeId && (e.targetHandle ?? '').startsWith('in-image'))
      if (!ins.length) return null
      const ref = refOf(producerOf(ins[0].source, ins[0].sourceHandle, 'image'))
      if (!ref || ref.kind === 'asset') return null   // 固定の画像だけなら対話実行のノード
      if (ins.length > 1) notes.push(`${labelOf(nodeId)} の画像入力は最初の 1 つだけを使います（複数の画像入力は未対応）`)
      const f = fold([ref], notes)
      if (!f.ok) return { ok: false, reason: 'upstream', upstream: f.upstream }
      return { ok: true, inputs: { image: ref }, deps: f.deps, aiDepth: f.aiDepth + 1, stage: f.stage + 1, notes }
    }
    if (k === 'tryOn') {
      // 試着（2b-3）: 服と モデル の 2 入力。配線は写真 / カット / 前段の結果、配線が写真由来でなければ固定の画像（参照画像・結果ノードの画像）、
      // モデルは配線が無ければノード内で選んだライブラリのカット（固定の画像）。どちらかが写真由来でなければ一括実行の対象ではない（対話実行だけ）
      const refFor = (handle: string): InputRef | null => {
        const e = edges.find((x) => x.target === nodeId && x.targetHandle === handle)
        if (!e) return null
        const r = refOf(producerOf(e.source, e.sourceHandle, 'image'))
        if (r) return r
        const url = byId.get(e.source)?.data?.output
        return typeof url === 'string' && url ? { kind: 'asset', url } : null
      }
      const pickedUrl = node.data?.model?.url
      const garment = refFor(TRY_ON_GARMENT_HANDLE)
      const model = refFor(TRY_ON_MODEL_HANDLE) ?? (typeof pickedUrl === 'string' && pickedUrl ? { kind: 'asset' as const, url: pickedUrl } : null)
      const perItem = (r: InputRef | null) => !!r && r.kind !== 'asset'
      if (!perItem(garment) && !perItem(model)) return null
      if (!garment) return { ok: false, reason: 'no_garment' }
      if (!model) return { ok: false, reason: 'no_model' }
      const f = fold([garment, model], notes)
      if (!f.ok) return { ok: false, reason: 'upstream', upstream: f.upstream }
      return { ok: true, inputs: { image: garment, model }, deps: f.deps, aiDepth: f.aiDepth + 1, stage: f.stage + 1, notes }
    }
    if (k === 'videoGen') {
      const startEdge = edges.find((e) => e.target === nodeId && e.targetHandle === VIDEO_GEN_START_HANDLE)
      const endEdge = edges.find((e) => e.target === nodeId && e.targetHandle === VIDEO_GEN_END_HANDLE)
      const start = startEdge ? refOf(producerOf(startEdge.source, startEdge.sourceHandle, 'image')) : null
      const end = endEdge ? refOf(producerOf(endEdge.source, endEdge.sourceHandle, 'image')) : null
      if (endEdge && !end) notes.push(`Video Generation（${labelOf(nodeId)}）の終了フレームは Batch Input / 参照画像 / AI ノードからの画像だけ使えます（無視します）`)
      const inputs: TaskInputs = {}
      if (!start) return null
      if (start.kind === 'asset' && (!end || end.kind === 'asset')) return null   // 固定の画像だけなら対話実行のノード（写真ごとに同じ動画を作らない）
      inputs.start = start
      if (end) inputs.end = end
      const f = fold([start, ...(end ? [end] : [])], notes)
      if (!f.ok) return { ok: false, reason: 'upstream', upstream: f.upstream }
      return { ok: true, inputs, deps: f.deps, aiDepth: f.aiDepth + 1, stage: f.stage + 1, notes }
    }
    // videoMerge: スロット順の動画入力。Video Generation / Video Merge（結果ノード経由も）以外は無視
    const slots = edges
      .filter((e) => e.target === nodeId && videoMergeSlotOf(e.targetHandle) !== null)
      .sort((a, b) => videoMergeSlotOf(a.targetHandle)! - videoMergeSlotOf(b.targetHandle)!)
    const videos: string[] = []
    let aiDepth = 0, stage = 0
    for (const e of slots) {
      const p = producerOf(e.source, e.sourceHandle, 'video')
      if (p.kind !== 'ai') { notes.push(`Video Merge（${labelOf(nodeId)}）の入力 ${videoMergeSlotOf(e.targetHandle)} は Video Generation の動画ではないため無視します`); continue }
      const up = analyze(p.nodeId)
      if (!up || !up.ok) { notes.push(`Video Merge（${labelOf(nodeId)}）の入力 ${videoMergeSlotOf(e.targetHandle)}（${labelOf(p.nodeId)}）は一括実行の対象外なので無視します`); continue }
      if (!videos.includes(p.nodeId)) videos.push(p.nodeId)
      aiDepth = Math.max(aiDepth, up.aiDepth); stage = Math.max(stage, up.stage); notes.push(...up.notes)
    }
    if (!videos.length) return { ok: false, reason: 'no_inputs' }
    return { ok: true, inputs: { videos }, deps: videos, aiDepth, stage: stage + 1, notes }
  }

  const tasks: PlannedTask[] = []
  const perItemIds = new Set<string>()   // 写真ごとの処理として扱った Image Generation（背景生成とは排他）
  const excludedUpstream = (nodeId: string, a: Analysis) => {
    if (!a.ok && a.reason === 'upstream') exclude(nodeId, `${labelOf(nodeId)} は前段（${labelOf(a.upstream)}）が一括実行の対象外のため対象外です`)
  }
  const push = (t: Omit<PlannedTask, 'terminal' | 'video' | 'dependsOn'> & { video?: VideoTaskMeta | null }) => {
    const deps = depsOf(t.inputs)
    tasks.push({ ...t, video: t.video ?? null, terminal: false, dependsOn: deps.length === 0 ? null : deps.length === 1 ? deps[0] : deps })
  }
  for (const node of nodes) {
    const k = nodeKindOf(node)
    if (!isPerItemKind(k)) continue
    const label = labelOf(node.id)   // Try-On は向きの予定つき（Try-On 正面）
    const a = analyze(node.id)
    if (!a) continue   // 写真由来の入力が無い（対話実行だけのノード）
    if (!a.ok) {
      if (k === 'removeBackground' && a.reason === 'not_connected') exclude(node.id, `Remove Background（${label}）は Batch Input に接続されていないため一括実行の対象外です`)
      else if (k === 'videoMerge' && a.reason === 'no_inputs') exclude(node.id, `Video Merge（${label}）につながる Video Generation が無いため一括実行の対象外です`)
      else if (k === 'tryOn' && a.reason === 'no_garment') exclude(node.id, `Try-On（${label}）は服の画像がつながっていないため一括実行の対象外です`)
      else if (k === 'tryOn' && a.reason === 'no_model') exclude(node.id, `Try-On（${label}）はモデルの画像が無いため一括実行の対象外です（Model ノードをつなぐか、参照画像のモデルタブから入れてください）`)
      else excludedUpstream(node.id, a)
      continue
    }
    for (const n of a.notes) warn(n)
    if (a.aiDepth > MAX_ITEM_STAGES && k !== 'videoMerge') { exclude(node.id, `AI 処理は 1 経路につき ${MAX_ITEM_STAGES} 段までです（${label} は ${a.aiDepth} 段目のため対象外）`); continue }
    if (k === 'removeBackground') {
      const req = buildEngineRequest(normalizeCutoutParams(node.data?.params), '__IMAGE_URL__')
      const input: Record<string, unknown> = { ...req.input }
      delete input.image_url
      // 切り抜きは常にマスクと透過画像の両方を保存する（2026-11-01: 後段をつなぐ順番に依存しないように）。BiRefNet は mask_only=false で image（透過）も返る
      if (req.endpoint.startsWith('fal-ai/birefnet')) input.mask_only = false
      push({ nodeId: node.id, scope: 'item', endpoint: req.endpoint, input, kind: 'cutout', stage: a.stage, label, dualOutput: true, inputs: a.inputs })
    } else if (k === 'imageGen') {
      perItemIds.add(node.id)
      const p = (node.data?.params ?? {}) as Record<string, unknown>
      const prompt = promptForGenerator({ nodes, edges }, node.id)
      if (!prompt) { exclude(node.id, `Image Generation（${label}）はプロンプトが空のため対象外です（プロンプトの欄に書くか、Text Prompt をつないでください）`); emptyPrompt.push(node.id); continue }
      const model = editModelOf(p)
      const req = buildImageEditRequest(model, prompt, p)
      push({ nodeId: node.id, scope: 'item', endpoint: req.endpoint, input: req.input, kind: 'imageEdit', stage: a.stage, label, dualOutput: false, inputs: a.inputs })
    } else if (k === 'tryOn') {
      // 試着は画像編集と同じ結果の扱い（生成結果の列・書き出し・ライブラリのフォルダ）。プロンプトは試着用の既定文 + 英訳した服の説明・補足
      const p = normalizeTryOnParams(node.data?.params)
      const prompt = tryOnPromptFromNote(p.note, snap?.promptTranslations ?? {})
      push({ nodeId: node.id, scope: 'item', endpoint: TRY_ON_ENDPOINT, input: buildTryOnInput(prompt, p), kind: 'imageEdit', stage: a.stage, label, dualOutput: false, inputs: a.inputs })
    } else if (k === 'videoGen') {
      const modelDef = videoModelById(node.data?.model) ?? videoModelById(PRODUCT_VIDEO_DEFAULT_MODEL)!
      // 画像 → 動画: 専用エンドポイント（i2vEndpoint）があるか、エンドポイント自体が image-to-video のモデル。参照動画が要るモデルは対象外
      if (!modelDef.i2vEndpoint && !modelDef.supportedModes.includes('image-to-video')) { exclude(node.id, `Video Generation（${label}）のモデル ${modelDef.name} は画像から動画を作れないため一括実行の対象外です`); continue }
      const inputs: TaskInputs = { ...a.inputs }
      const withElements = !!inputs.elements && modelDef.features.includes('elements')   // 旧ジョブ（Cut Set Input の一式）だけ。新しい計画は付けない
      if (inputs.elements && !withElements) { warn(`参照カット一式（elements）は Kling v3 Pro だけが使えます（${label} では無視します）`); delete inputs.elements }
      if (edges.some((e) => e.target === node.id && (e.targetHandle ?? '').startsWith('in-element-'))) warn(`${label} の参照一式（Kling Element）は一括処理では使いません（キャンバスで個別に生成するときに使います）`)
      if (inputs.end && !modelDef.endImageParam) { warn(`終了フレームは ${modelDef.name} では使えません（${label} では無視します）`); delete inputs.end }
      const { prompt, negative, turned } = videoPromptOf(nodes, edges, node, inputs, snap?.promptTranslations)
      if (!prompt) { exclude(node.id, `Video Generation（${label}）はプロンプトが空のため対象外です（Text Prompt をつなぐか、動きの欄に書いてください）`); emptyPrompt.push(node.id); continue }
      const built = buildVideoTaskInput(modelDef, node, prompt, negative, turned)
      push({ nodeId: node.id, scope: 'item', endpoint: modelDef.i2vEndpoint ?? modelDef.endpoint, input: built.input, kind: 'videoShot', stage: a.stage, label, dualOutput: false, inputs, video: { ...built.meta, elements: withElements } })
    } else {
      push({ nodeId: node.id, scope: 'item', endpoint: MERGE_VIDEOS_ENDPOINT, input: {}, kind: 'videoMerge', stage: a.stage, label, dualOutput: false, inputs: a.inputs })
    }
  }

  // 前段が対象外になった（プロンプト無しなど分析後の除外）タスクは外す。結合は使える入力だけ残す
  for (;;) {
    const have = new Set(tasks.map((t) => t.nodeId))
    let changed = false
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i]
      if (t.kind === 'videoMerge') {
        const videos = (t.inputs.videos ?? []).filter((v) => have.has(v))
        if (videos.length !== (t.inputs.videos ?? []).length) {
          const dropped = (t.inputs.videos ?? []).filter((v) => !have.has(v)).map(labelOf)
          if (!videos.length) { exclude(t.nodeId, `Video Merge（${t.label}）につながる Video Generation（${dropped.join('・')}）が対象外のため、結合も対象外です`); tasks.splice(i, 1); changed = true; continue }
          t.inputs = { videos }; t.dependsOn = videos.length === 1 ? videos[0] : videos
        }
        continue
      }
      const missing = depsOf(t.inputs).find((d) => !have.has(d))
      if (missing) { exclude(t.nodeId, `${t.label} は前段（${labelOf(missing)}）が一括実行の対象外のため対象外です`); tasks.splice(i, 1); changed = true }
    }
    if (!changed) break
  }

  // 動画があるジョブは動画だけを作る（2026-10-31 決定）: 動画につながらない画像のタスクは対象外。
  // 外した画像のタスクは droppedForVideo に残す（App の判定「画像と動画の両方ができる構成」に使う・2026-11-02）
  let droppedForVideo: PlannedTask[] = []
  const hasVideo = tasks.some((t) => t.kind === 'videoShot')
  if (hasVideo) {
    const feeding = new Set<string>()
    const visit = (id: string) => { if (feeding.has(id)) return; feeding.add(id); const t = tasks.find((x) => x.nodeId === id); if (t) for (const d of depsOf(t.inputs)) visit(d) }
    for (const t of tasks) if (t.kind === 'videoShot' || t.kind === 'videoMerge') visit(t.nodeId)
    const dropped = tasks.filter((t) => !feeding.has(t.nodeId))
    droppedForVideo = dropped
    if (dropped.length) { warn(`この構成では動画だけを処理します（${dropped.map((t) => t.label).join('・')} の画像は作りません）`); for (const t of dropped) excluded[t.nodeId] = 'この構成では動画だけを処理します（画像は作りません）' }
    for (let i = tasks.length - 1; i >= 0; i--) if (!feeding.has(tasks[i].nodeId)) tasks.splice(i, 1)
    if (nodes.some((n) => nodeKindOf(n) === 'productLayout')) warn('この構成では Product Layout の画像は作りません（動画だけを処理します）')
  }

  // 2 段目の生成/動画が切り抜きを受け取るなら、その切り抜きはマスクと透過画像の両方を受け取る（fal 1 回で両方返る）
  for (const t of tasks) {
    for (const r of refsOf(t.inputs)) {
      if (r.kind !== 'dep' || r.prefer !== 'cutout') continue
      const dep = tasks.find((x) => x.nodeId === r.nodeId)
      if (dep && dep.kind === 'cutout') { dep.dualOutput = true; if (dep.endpoint.startsWith('fal-ai/birefnet')) dep.input.mask_only = false }
    }
  }
  // 終端の動画（この先に結合が無い）
  const merged = new Set(tasks.filter((t) => t.kind === 'videoMerge').flatMap((t) => t.inputs.videos ?? []))
  for (const t of tasks) if (t.kind === 'videoShot' || t.kind === 'videoMerge') t.terminal = !merged.has(t.nodeId)
  // ショットの並び（結合のスロット順・無ければ出現順）と役割を __shot に（結果欄の見出し・旧ジョブと同じ形）
  const order: string[] = []
  for (const t of tasks) if (t.kind === 'videoMerge') for (const v of t.inputs.videos ?? []) if (!order.includes(v)) order.push(v)
  for (const t of tasks) if (t.kind === 'videoShot' && !order.includes(t.nodeId)) order.push(t.nodeId)
  for (const t of tasks) {
    if (t.kind !== 'videoShot') continue
    t.input.__shot = { index: order.indexOf(t.nodeId), role: roleOfRef(t.inputs.start), endRole: roleOfRef(t.inputs.end), duration: Number(t.input.duration) || 0 }
  }
  // 段の順に並べる（1 段目 → 2 段目 → 結合）
  tasks.sort((x, y) => x.stage - y.stage)

  // 背景生成: レイアウトの背景入力に行き着く生成器ごとに 1 件（ジョブごと）。動画のジョブでは作らない
  const canvas = { nodes, edges }
  const generators = new Set(backgroundSourcesOf(canvas).map((s) => s.generatorNodeId).filter((g): g is string => !!g))
  for (const genId of generators) {
    const gen = byId.get(genId)
    const p = (gen?.data?.params ?? {}) as Record<string, unknown>
    const label = nodeLabelOf(gen)
    if (perItemIds.has(genId)) {
      warn(`Image Generation（${label}）は写真由来の画像入力があるため写真ごとに実行します。背景には使えません（背景の生成は画像入力の無い「ジョブごと」の Image Generation にしてください）`)
      continue
    }
    if (hasVideo) { warn(`背景の Image Generation（${label}）は動画の処理では使いません`); continue }
    if (p.executionScope !== 'job') {
      warn(`背景の Image Generation（${label}）は「一括実行のスコープ: ジョブごと」にしてください（アイテムごとの背景生成は未対応のため対象外）`)
      continue
    }
    const prompt = promptForGenerator(canvas, genId)
    if (!prompt) {
      warn(`背景の Image Generation（${label}）はプロンプトが空のため対象外です（プロンプトの欄に書くか、Text Prompt をつないでください）`)
      continue
    }
    const model = typeof p.model === 'string' && p.model ? p.model : 'fal-ai/nano-banana-2'
    tasks.push({ nodeId: genId, scope: 'job', endpoint: model, input: buildTextToImageInput(model, prompt, p), kind: 'imageGen', stage: 1, dependsOn: null, label, dualOutput: false, inputs: {}, terminal: false, video: null })
  }
  for (const node of nodes) {
    if (nodeKindOf(node) === 'imageGen' && node.data?.params?.executionScope === 'job' && !generators.has(node.id) && !perItemIds.has(node.id)) {
      warn(`Image Generation（${nodeLabelOf(node)}）は Product Layout の背景入力につながっていないため一括実行の対象外です`)
    }
  }
  return { tasks, warnings, excluded, droppedForVideo, emptyPrompt }
}

/** タスクの入力の参照（画像・モデル・開始・終了） */
export function refsOf(inputs: TaskInputs | null | undefined): InputRef[] {
  return [inputs?.image, inputs?.model, inputs?.start, inputs?.end].filter((r): r is InputRef => !!r)
}
/** 待つ前段のノード id（参照の dep と結合の入力） */
export function depsOf(inputs: TaskInputs | null | undefined): string[] {
  const out: string[] = []
  for (const r of refsOf(inputs)) if (r.kind === 'dep' && !out.includes(r.nodeId)) out.push(r.nodeId)
  for (const v of inputs?.videos ?? []) if (!out.includes(v)) out.push(v)
  return out
}

/** Video Generation の fal 入力（URL 以外）とメタ。比率 'auto' は Kling（3.0 以外）だけ投入時にアイテムの寸法から決める */
/** 終了フレームありのショットの指示への追従（cfg_scale・Kling 系）。欄で変えられ、無ければ既定の 0.7 */
export function cfgScaleOf(data: Record<string, unknown> | null | undefined): number {
  const p = (data?.params ?? {}) as Record<string, unknown>
  const v = p.cfgScale
  return typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 1 ? v : END_CUT_CFG_SCALE
}

function buildVideoTaskInput(modelDef: VideoModelDefinition, node: SnapshotNode, prompt: string, negative: string, turned: boolean): { input: Record<string, unknown>; meta: Omit<VideoTaskMeta, 'elements'> } {
  const d = (node.data ?? {}) as Record<string, unknown>
  const { safeDuration, requestedDuration, isAutoDuration } = resolveSafeDuration(modelDef, str(d.duration) || undefined)
  const safeFps = resolveSafeFps(typeof d.fps === 'number' ? d.fps : undefined, isAutoDuration, requestedDuration)
  const request: VideoGenerationRequest = {
    prompt, model: modelDef.id, duration: safeDuration,
    resolution: (str(d.resolution) || undefined) as VideoGenerationRequest['resolution'],
    aspectRatio: (str(d.aspectRatio) || 'auto') as VideoGenerationRequest['aspectRatio'],
    fps: safeFps as VideoGenerationRequest['fps'],
    audioEnabled: d.audioEnabled === true, seed: typeof d.seed === 'number' ? d.seed : null, mode: 'image-to-video', imageUrl: '__START__',
    ...(negative ? { negativePrompt: negative } : {}), ...(turned ? { cfgScale: cfgScaleOf(d) } : {}),
  }
  const resolved = resolveAspectRatio(modelDef, request)
  const input = buildVideoInput(modelDef, request, safeDuration, safeFps, resolved ?? undefined)
  delete input[modelDef.startImageParam ?? 'image_url']
  return { input, meta: { modelId: modelDef.id, startParam: modelDef.startImageParam ?? 'image_url', endParam: modelDef.endImageParam ?? null, aspectAuto: resolved === null, aspectRatios: modelDef.supportedAspectRatios } }
}

// ───────────────────────── アイテムごとの充足（§5.3） ─────────────────────────
export interface ItemLike { cuts?: ItemCut[] | Array<{ role: string; path: string }> | null }
/** 参照がその SKU で揃うか（写真は常に 1 枚ある前提。役割のカットが無ければ不可） */
export function refSatisfied(ref: InputRef, item: ItemLike, taskByNode: Map<string, PlannedTask>): boolean {
  const cuts = (item.cuts ?? []) as ItemCut[]
  if (ref.kind === 'photo' || ref.kind === 'asset') return true
  if (ref.kind === 'cut') return !!cutOf(cuts, ref.role)
  if (ref.kind === 'set') return !!cutOf(cuts, FRONTAL_ROLE)
  const dep = taskByNode.get(ref.nodeId)
  return !!dep && taskSatisfied(dep, item, taskByNode)
}
/** このタスクをその SKU で作れるか（結合は入力が 1 本でもあれば作る） */
export function taskSatisfied(task: PlannedTask, item: ItemLike, taskByNode: Map<string, PlannedTask>): boolean {
  if (task.scope !== 'item') return true
  if (task.kind === 'videoMerge') return availableVideos(task, item, taskByNode).length > 0
  if (task.inputs.elements && !cutOf((item.cuts ?? []) as ItemCut[], FRONTAL_ROLE)) return false
  return refsOf(task.inputs).every((r) => refSatisfied(r, item, taskByNode))
}
/** 結合がその SKU で待つ前段（作れるショットだけ・スロット順） */
export function availableVideos(task: PlannedTask, item: ItemLike, taskByNode: Map<string, PlannedTask>): string[] {
  return (task.inputs.videos ?? []).filter((v) => { const t = taskByNode.get(v); return !!t && taskSatisfied(t, item, taskByNode) })
}
export const taskMapOf = (tasks: PlannedTask[]): Map<string, PlannedTask> => new Map(tasks.map((t) => [t.nodeId, t]))

// ───────────────────────── 画面向けの派生 ─────────────────────────
/** 動画を作る写しか（結果欄・ライブラリ・App の判定） */
export function snapshotHasVideo(snapshot: WorkflowSnapshot | null | undefined): boolean {
  return planTasks(snapshot).tasks.some((t) => t.kind === 'videoShot')
}
