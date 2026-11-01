// 一括実行の計画（純関数）。サーバー（api/batch/_batchLogic.ts）と画面（App の構成・結果欄の判定・ノードの対象表示）が同じ関数を使う。
// 設計: docs/specs/product-video-nodes.md §5
// - 写真（SKU）ごとに動くノード: Remove Background / Image Generation（画像入力あり）/ Video Generation / Video Merge（結合は AI 段に数えない）
// - 入力の出どころ: Batch Input（写真）、Cut Set Input（役割のカット・カット一式）、前段の AI ノード（結果ノード経由は透過）
// - 旧 Product Video ノードは計画の前に新しいノード群へ展開する（expandProductVideo。id は決定的で既存ジョブのタスク id と一致）
// - 動画タスクが 1 つでもあれば、動画につながらない画像のタスクは対象外（2026-10-31 決定）
import { buildEngineRequest, normalizeCutoutParams } from '../cutout/engines'
import { buildImageEditRequest, buildTextToImageInput, editModelOf } from '../ai/imageGenModels'
import { backgroundSourcesOf, promptForGenerator } from './background'
import { buildVideoInput, resolveAspectRatio, resolveSafeDuration, resolveSafeFps, videoModelById } from '../ai/videoModels'
import type { VideoGenerationRequest, VideoModelDefinition } from '../ai/types'
import { CUT_ROLES, END_CUT_CFG_SCALE, FRONTAL_ROLE, MERGE_VIDEOS_ENDPOINT, builtinEnglish, cutOf, isStaticPresetMotion, normalizeProductVideoParams, shotRoleLabel, turnInstruction, type CutRole, type ItemCut, type VideoShotSpec } from '../video/productVideo'
import { textsNeedingTranslation } from '../video/translate'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SnapshotNode { id: string; type?: string; data?: any; position?: { x: number; y: number } }
export interface SnapshotEdge { id?: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }
/** promptTranslations: 日本語のプロンプト → 英語（create で作って写しに添える。submit の計画が使う） */
export interface WorkflowSnapshot { nodes?: SnapshotNode[]; edges?: SnapshotEdge[]; promptTranslations?: Record<string, string> }

export type PlannedKind = 'cutout' | 'imageGen' | 'imageEdit' | 'videoShot' | 'videoMerge'
/** タスクの入力の出どころ（投入時に buildTaskInput が解決する。§5.2） */
export type InputRef =
  | { kind: 'photo' }                                            // Batch Input の写真（item.source_path）
  | { kind: 'cut'; role: CutRole }                               // Cut Set Input の役割カット（item.cuts[role]）
  | { kind: 'set' }                                              // カット一式（正面 + 別角度 → elements）
  | { kind: 'dep'; nodeId: string; prefer: 'cutout' | 'result' } // 前段の結果（切り抜きは透過画像 cutout_path を優先）
export interface TaskInputs { image?: InputRef; start?: InputRef; end?: InputRef; elements?: { kind: 'set' }; videos?: string[] }
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
export const CUT_SET_SET_HANDLE = 'out-cuts-set'
export const CUT_SET_ITEM_HANDLE = 'out-item-item'
export const cutSetRoleHandle = (role: CutRole): string => `out-image-${role}`
export const cutSetRoleOfHandle = (handle: string | null | undefined): CutRole | null => {
  const m = /^out-image-([a-z]+)$/.exec(handle ?? '')
  const role = m?.[1]
  return role && CUT_ROLES.some((r) => r.id === role) ? (role as CutRole) : null
}
export const VIDEO_GEN_START_HANDLE = 'in-image'
export const VIDEO_GEN_END_HANDLE = 'in-image-end'
export const VIDEO_GEN_SET_HANDLE = 'in-cuts-set'
export const VIDEO_GEN_TEXT_HANDLES = ['in-text', 'in-text-prompt']
export const VIDEO_OUTPUT_HANDLE = 'out-video'
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
  imageDisplayNode: 'imageDisplay', textPromptNode: 'textPrompt', referenceImageNode: 'referenceImage', cutSetInputNode: 'cutSetInput', batchInputNode: 'batchInput',
  removeBackgroundNode: 'removeBackground', productLayoutNode: 'productLayout', imageGenerationNode: 'imageGen', exportNode: 'export', productVideoNode: 'productVideo', tryOnNode: 'tryOn',
}
export function nodeKindOf(n: SnapshotNode | null | undefined): string | undefined {
  const t = n?.data?.type
  if (typeof t === 'string' && t) return t
  return n?.type ? RF_TYPE_TO_KIND[n.type] : undefined
}
const DEFAULT_LABELS: Record<string, string> = { removeBackground: 'Remove Background', imageGen: 'Image Generation', videoGen: 'Video Generation', videoMerge: 'Video Merge', tryOn: 'Try-On' }
export function nodeLabelOf(n: SnapshotNode | null | undefined): string {
  const l = n?.data?.label
  return typeof l === 'string' && l.trim() ? l.trim() : (DEFAULT_LABELS[nodeKindOf(n) ?? ''] ?? n?.id ?? '')
}
const nodesOf = (s: WorkflowSnapshot | null | undefined): SnapshotNode[] => (Array.isArray(s?.nodes) ? s!.nodes!.filter((n) => !!n && typeof n.id === 'string') : [])
const edgesOf = (s: WorkflowSnapshot | null | undefined): SnapshotEdge[] => (Array.isArray(s?.edges) ? s!.edges!.filter((e) => !!e && typeof e.source === 'string' && typeof e.target === 'string') : [])

// ───────────────────────── 旧 Product Video ノードの展開（§7） ─────────────────────────
export const LEGACY_CUTS_SUFFIX = ':cuts'
export const LEGACY_BASE_SUFFIX = ':base'
export const legacyShotNodeId = (pvId: string, index: number): string => `${pvId}:shot:${index}`
export const PRODUCT_VIDEO_DEFAULT_MODEL = 'kling-v3-pro'
export const ELEMENT_TAG = '@Element1 wearing the garment.'
const TO_END = 'One continuous take with no cuts: the pose changes directly into the final frame by the shortest movement.'

export function hasLegacyProductVideo(snapshot: WorkflowSnapshot | null | undefined): boolean {
  return nodesOf(snapshot).some((n) => nodeKindOf(n) === 'productVideo')
}

/** 旧 Product Video ノード 1 つを Cut Set Input + Text Prompt（共通の説明）+ Video Generation ×N + Video Merge に展開する（id は決定的）。 */
export function expandProductVideoNode(pv: SnapshotNode): { nodes: SnapshotNode[]; edges: SnapshotEdge[] } {
  const params = normalizeProductVideoParams(pv.data?.params)
  const label = typeof pv.data?.label === 'string' && pv.data.label.trim() ? pv.data.label.trim() : 'Product Video'
  const x = pv.position?.x ?? 0, y = pv.position?.y ?? 0
  const cutsId = `${pv.id}${LEGACY_CUTS_SUFFIX}`, baseId = `${pv.id}${LEGACY_BASE_SUFFIX}`
  const nodes: SnapshotNode[] = [
    { id: cutsId, type: 'cutSetInputNode', position: { x, y }, data: { type: 'cutSetInput', label: 'Cut Set Input', params: {}, status: 'idle', items: [], currentItemId: null } },
    { id: baseId, type: 'textPromptNode', position: { x, y: y + 560 }, data: { type: 'textPrompt', label: '共通の説明', params: { prompt: params.basePrompt }, status: 'idle' } },
  ]
  const edges: SnapshotEdge[] = []
  params.shots.forEach((shot, i) => {
    const id = legacyShotNodeId(pv.id, i)
    nodes.push({
      id, type: 'videoGenerationNode', position: { x: x + 420, y: y + i * 320 },
      data: {
        type: 'videoGen', label: `${label} ${i + 1}: ${shotRoleLabel(shot)}`,
        model: PRODUCT_VIDEO_DEFAULT_MODEL, duration: String(shot.duration), resolution: '1080p', aspectRatio: 'auto', fps: 25, audioEnabled: false, seed: null, count: 1,
        status: 'idle', progress: '', videoUrl: null, fileName: null, error: null, requestId: null, requestEndpoint: null, activeDisplayNodeId: null,
        // 終了カットありで静止用の定型文が残っていれば使わない（回転指示が自動で付く）
        params: { prompt: shot.endRole && isStaticPresetMotion(shot.motion) ? '' : shot.motion, negativePrompt: params.negativePrompt, autoTurn: !!shot.endRole },
      },
    })
    const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): SnapshotEdge => ({ id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle })
    edges.push(edge(cutsId, cutSetRoleHandle(shot.role), id, VIDEO_GEN_START_HANDLE))
    if (shot.endRole) edges.push(edge(cutsId, cutSetRoleHandle(shot.endRole), id, VIDEO_GEN_END_HANDLE))
    edges.push(edge(cutsId, CUT_SET_SET_HANDLE, id, VIDEO_GEN_SET_HANDLE))
    edges.push(edge(baseId, 'out-text-text-out', id, 'in-text'))
    edges.push(edge(id, VIDEO_OUTPUT_HANDLE, pv.id, videoMergeSlotHandle(i + 1)))
  })
  nodes.push({ id: pv.id, type: 'videoMergeNode', position: { x: x + 860, y }, data: { type: 'videoMerge', label: `${label}（結合）`, params: {}, status: 'idle', videoUrl: null } })
  return { nodes, edges }
}

/** 写しに旧 Product Video ノードがあれば展開した写しを返す（無ければそのまま） */
export function expandProductVideo<T extends WorkflowSnapshot | null | undefined>(snapshot: T): T {
  if (!snapshot || !hasLegacyProductVideo(snapshot)) return snapshot
  const nodes: SnapshotNode[] = []
  const edges: SnapshotEdge[] = [...edgesOf(snapshot)]
  for (const n of nodesOf(snapshot)) {
    if (nodeKindOf(n) !== 'productVideo') { nodes.push(n); continue }
    const ex = expandProductVideoNode(n)
    nodes.push(...ex.nodes); edges.push(...ex.edges)
  }
  return { ...snapshot, nodes, edges } as T
}

// ───────────────────────── 入力ノード ─────────────────────────
export function inputNodesOf(snapshot: WorkflowSnapshot | null | undefined): { batchInputId: string | null; cutSetInputId: string | null } {
  const nodes = nodesOf(expandProductVideo(snapshot))
  return {
    batchInputId: nodes.find((n) => nodeKindOf(n) === 'batchInput')?.id ?? null,
    cutSetInputId: nodes.find((n) => nodeKindOf(n) === 'cutSetInput')?.id ?? null,
  }
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

/** Video Generation のプロンプトと negative（§4.2）。始点と終点が役割カットなら回転指示を自動で付ける（autoTurn 既定 on） */
export function videoPromptOf(nodes: SnapshotNode[], edges: SnapshotEdge[], node: SnapshotNode, inputs: TaskInputs, translations: Record<string, string> | null | undefined, withElements: boolean): { prompt: string; negative: string; turned: boolean } {
  const tr = translator(translations)
  const p = (node.data?.params ?? {}) as Record<string, unknown>
  const base = textsInto(nodes, edges, node.id).map(tr).join('\n\n')
  const ownRaw = str(p.prompt).trim()
  const startRole = inputs.start?.kind === 'cut' ? inputs.start.role : null
  const endRole = inputs.end?.kind === 'cut' ? inputs.end.role : null
  const turn = p.autoTurn !== false && startRole && endRole && startRole !== endRole ? turnInstruction(startRole, endRole) : null
  const own = turn && isStaticPresetMotion(ownRaw) ? '' : tr(ownRaw)
  const motion = turn ? [turn.motion, own, TO_END].filter(Boolean).join(' ') : own
  const prompt = `${base ? base + '\n' : ''}${withElements ? ELEMENT_TAG + ' ' : ''}${motion}`.trim()
  const negative = [tr(str(p.negativePrompt)), turn?.negative].filter(Boolean).join(', ')
  return { prompt, negative, turned: !!turn }
}

/** ジョブ作成時に英訳が要る文（計画対象の Video Generation の動き・避けたいこと・つないだテキストのうち日本語で対訳の無いもの） */
export function promptTextsToTranslateForPlan(snapshot: WorkflowSnapshot | null | undefined): string[] {
  const snap = expandProductVideo(snapshot)
  const nodes = nodesOf(snap), edges = edgesOf(snap)
  const { tasks } = planTasks(snap)
  return textsNeedingTranslation(tasks.filter((t) => t.kind === 'videoShot').flatMap((t) => videoPromptSources(nodes, edges, t.nodeId, t.inputs)))
}

/** Video Generation のプロンプトの素（翻訳の対象）: 動き（回転指示が付くときの静止用定型文は除く）・避けたいこと・つないだテキスト */
export function videoPromptSources(nodes: SnapshotNode[], edges: SnapshotEdge[], nodeId: string, inputs: TaskInputs): string[] {
  const node = nodes.find((n) => n.id === nodeId)
  const p = (node?.data?.params ?? {}) as Record<string, unknown>
  const startRole = inputs.start?.kind === 'cut' ? inputs.start.role : null
  const endRole = inputs.end?.kind === 'cut' ? inputs.end.role : null
  const turned = p.autoTurn !== false && startRole && endRole && startRole !== endRole
  return [...(turned && isStaticPresetMotion(str(p.prompt)) ? [] : [str(p.prompt)]), str(p.negativePrompt), ...textsInto(nodes, edges, nodeId)]
}

// ───────────────────────── 計画 ─────────────────────────
type Producer = { kind: 'input'; ref: InputRef } | { kind: 'ai'; nodeId: string } | { kind: 'other' }
type Analysis = { ok: true; inputs: TaskInputs; deps: string[]; aiDepth: number; stage: number; notes: string[] } | { ok: false; reason: 'not_connected' | 'upstream' | 'no_inputs'; upstream?: string }

/**
 * 写しから AI 処理ノードを抽出する（仕様 4-2・フェーズ C・§5）。
 * - アイテムごと: Batch Input の写真 / Cut Set Input のカットに行き着く Remove Background / Image Generation（編集）/ Video Generation、
 *   それらを順に受ける Video Merge。AI 段は 1 経路 2 段まで（結合は数えない）
 * - ジョブごと: Product Layout の背景入力につながる Image Generation（executionScope='job'）1 件（Step 8）。動画があるジョブでは作らない
 */
export function planTasks(snapshot: WorkflowSnapshot | null | undefined): { tasks: PlannedTask[]; warnings: string[] } {
  const snap = expandProductVideo(snapshot)
  const nodes = nodesOf(snap), edges = edgesOf(snap)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kindOf = (id: string | undefined) => nodeKindOf(id ? byId.get(id) : undefined)
  const labelOf = (id: string | undefined) => nodeLabelOf(id ? byId.get(id) : undefined)
  const warnings: string[] = []
  const warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w) }

  // 画像/動画の出どころ（結果ノードは透過して生成器へ）
  const producerOf = (sourceId: string, sourceHandle: string | null | undefined, want: 'image' | 'video'): Producer => {
    const k = kindOf(sourceId)
    if (want === 'image') {
      if (k === 'batchInput') return { kind: 'input', ref: { kind: 'photo' } }
      if (k === 'cutSetInput') {
        if (sourceHandle === CUT_SET_SET_HANDLE) return { kind: 'input', ref: { kind: 'set' } }
        const role = cutSetRoleOfHandle(sourceHandle)
        return role ? { kind: 'input', ref: { kind: 'cut', role } } : { kind: 'other' }
      }
      if (k === 'removeBackground' || k === 'imageGen') return { kind: 'ai', nodeId: sourceId }
      if (k === 'imageDisplay') {
        const feed = edges.find((e) => e.target === sourceId && kindOf(e.source) === 'imageGen')
        return feed ? { kind: 'ai', nodeId: feed.source } : { kind: 'other' }
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
  const refOf = (p: Producer): InputRef | null => (p.kind === 'input' ? p.ref : p.kind === 'ai' ? { kind: 'dep', nodeId: p.nodeId, prefer: preferOf(p.nodeId) } : null)
  const isPerItemKind = (k: string | undefined) => k === 'removeBackground' || k === 'imageGen' || k === 'videoGen' || k === 'videoMerge'

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
      if (!ref) return { ok: false, reason: 'not_connected' }
      const f = fold([ref], notes)
      if (!f.ok) return { ok: false, reason: 'upstream', upstream: f.upstream }
      return { ok: true, inputs: { image: ref }, deps: f.deps, aiDepth: f.aiDepth + 1, stage: f.stage + 1, notes }
    }
    if (k === 'imageGen') {
      // Image Generation は「一括実行のスコープ」に関わらず、写真由来の画像入力があれば写真ごと（スコープ「ジョブごと」は背景生成＝画像入力なしのときだけ意味を持つ）
      const ins = edges.filter((e) => e.target === nodeId && (e.targetHandle ?? '').startsWith('in-image'))
      if (!ins.length) return null
      const ref = refOf(producerOf(ins[0].source, ins[0].sourceHandle, 'image'))
      if (!ref) return null
      if (ins.length > 1) notes.push(`${labelOf(nodeId)} の画像入力は最初の 1 つだけを使います（複数の画像入力は未対応）`)
      const f = fold([ref], notes)
      if (!f.ok) return { ok: false, reason: 'upstream', upstream: f.upstream }
      return { ok: true, inputs: { image: ref }, deps: f.deps, aiDepth: f.aiDepth + 1, stage: f.stage + 1, notes }
    }
    if (k === 'videoGen') {
      const startEdge = edges.find((e) => e.target === nodeId && e.targetHandle === VIDEO_GEN_START_HANDLE)
      const endEdge = edges.find((e) => e.target === nodeId && e.targetHandle === VIDEO_GEN_END_HANDLE)
      const setEdge = edges.find((e) => e.target === nodeId && e.targetHandle === VIDEO_GEN_SET_HANDLE && kindOf(e.source) === 'cutSetInput')
      let start = startEdge ? refOf(producerOf(startEdge.source, startEdge.sourceHandle, 'image')) : null
      const end = endEdge ? refOf(producerOf(endEdge.source, endEdge.sourceHandle, 'image')) : null
      if (endEdge && !end) notes.push(`Video Generation（${labelOf(nodeId)}）の終了フレームは Batch Input / Cut Set Input / AI ノードからの画像だけ使えます（無視します）`)
      const inputs: TaskInputs = {}
      if (setEdge) inputs.elements = { kind: 'set' }
      if (!start && setEdge) start = { kind: 'cut', role: FRONTAL_ROLE }   // 開始フレーム未接続なら正面を開始に（今までどおり）
      if (!start) return null
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
    if (!a.ok && a.reason === 'upstream') warn(`${labelOf(nodeId)} は前段（${labelOf(a.upstream)}）が一括実行の対象外のため対象外です`)
  }
  const push = (t: Omit<PlannedTask, 'terminal' | 'video' | 'dependsOn'> & { video?: VideoTaskMeta | null }) => {
    const deps = depsOf(t.inputs)
    tasks.push({ ...t, video: t.video ?? null, terminal: false, dependsOn: deps.length === 0 ? null : deps.length === 1 ? deps[0] : deps })
  }
  for (const node of nodes) {
    const k = nodeKindOf(node)
    if (!isPerItemKind(k)) continue
    const label = nodeLabelOf(node)
    const a = analyze(node.id)
    if (!a) continue   // 写真由来の入力が無い（対話実行だけのノード）
    if (!a.ok) {
      if (k === 'removeBackground' && a.reason === 'not_connected') warn(`Remove Background（${label}）は Batch Input に接続されていないため一括実行の対象外です`)
      else if (k === 'videoMerge' && a.reason === 'no_inputs') warn(`Video Merge（${label}）につながる Video Generation が無いため一括実行の対象外です`)
      else excludedUpstream(node.id, a)
      continue
    }
    for (const n of a.notes) warn(n)
    if (a.aiDepth > MAX_ITEM_STAGES && k !== 'videoMerge') { warn(`AI 処理は 1 経路につき ${MAX_ITEM_STAGES} 段までです（${label} は ${a.aiDepth} 段目のため対象外）`); continue }
    if (k === 'removeBackground') {
      const req = buildEngineRequest(normalizeCutoutParams(node.data?.params), '__IMAGE_URL__')
      const input: Record<string, unknown> = { ...req.input }
      delete input.image_url
      push({ nodeId: node.id, scope: 'item', endpoint: req.endpoint, input, kind: 'cutout', stage: a.stage, label, dualOutput: false, inputs: a.inputs })
    } else if (k === 'imageGen') {
      perItemIds.add(node.id)
      const p = (node.data?.params ?? {}) as Record<string, unknown>
      const prompt = promptForGenerator({ nodes, edges }, node.id)
      if (!prompt) { warn(`Image Generation（${label}）はプロンプトが空のため対象外です（Text Prompt をつないでください）`); continue }
      const model = editModelOf(p)
      const req = buildImageEditRequest(model, prompt, p)
      push({ nodeId: node.id, scope: 'item', endpoint: req.endpoint, input: req.input, kind: 'imageEdit', stage: a.stage, label, dualOutput: false, inputs: a.inputs })
    } else if (k === 'videoGen') {
      const modelDef = videoModelById(node.data?.model) ?? videoModelById(PRODUCT_VIDEO_DEFAULT_MODEL)!
      // 画像 → 動画: 専用エンドポイント（i2vEndpoint）があるか、エンドポイント自体が image-to-video のモデル。参照動画が要るモデルは対象外
      if (!modelDef.i2vEndpoint && !modelDef.supportedModes.includes('image-to-video')) { warn(`Video Generation（${label}）のモデル ${modelDef.name} は画像から動画を作れないため一括実行の対象外です`); continue }
      const inputs: TaskInputs = { ...a.inputs }
      const withElements = !!inputs.elements && modelDef.features.includes('elements')
      if (inputs.elements && !withElements) { warn(`参照カット一式（elements）は Kling v3 Pro だけが使えます（${label} では無視します）`); delete inputs.elements }
      if (inputs.end && !modelDef.endImageParam) { warn(`終了フレームは ${modelDef.name} では使えません（${label} では無視します）`); delete inputs.end }
      const { prompt, negative, turned } = videoPromptOf(nodes, edges, node, inputs, snap?.promptTranslations, withElements)
      if (!prompt) { warn(`Video Generation（${label}）はプロンプトが空のため対象外です（Text Prompt をつなぐか、動きの欄に書いてください）`); continue }
      const built = buildVideoTaskInput(modelDef, node, prompt, negative, turned)
      push({ nodeId: node.id, scope: 'item', endpoint: modelDef.i2vEndpoint ?? modelDef.endpoint, input: built.input, kind: 'videoShot', stage: a.stage, label, dualOutput: false, inputs, video: { ...built.meta, elements: withElements } })
    } else {
      push({ nodeId: node.id, scope: 'item', endpoint: MERGE_VIDEOS_ENDPOINT, input: {}, kind: 'videoMerge', stage: a.stage, label, dualOutput: false, inputs: a.inputs })
    }
  }

  // Try-On（2026-11-01・2b-2 は対話実行のみ）: 写真由来の入力につながっていれば、まだ一括実行に対応していないことを伝える（2b-3 で対応）
  for (const node of nodes) {
    if (nodeKindOf(node) !== 'tryOn') continue
    const fed = edges.some((e) => e.target === node.id && (e.targetHandle ?? '').startsWith('in-image') && producerOf(e.source, e.sourceHandle, 'image').kind !== 'other')
    if (fed) warn(`Try-On（${nodeLabelOf(node)}）は一括実行にまだ対応していません（今は対話実行だけです）`)
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
          if (!videos.length) { warn(`Video Merge（${t.label}）につながる Video Generation（${dropped.join('・')}）が対象外のため、結合も対象外です`); tasks.splice(i, 1); changed = true; continue }
          t.inputs = { videos }; t.dependsOn = videos.length === 1 ? videos[0] : videos
        }
        continue
      }
      const missing = depsOf(t.inputs).find((d) => !have.has(d))
      if (missing) { warn(`${t.label} は前段（${labelOf(missing)}）が一括実行の対象外のため対象外です`); tasks.splice(i, 1); changed = true }
    }
    if (!changed) break
  }

  // 動画があるジョブは動画だけを作る（2026-10-31 決定）: 動画につながらない画像のタスクは対象外
  const hasVideo = tasks.some((t) => t.kind === 'videoShot')
  if (hasVideo) {
    const feeding = new Set<string>()
    const visit = (id: string) => { if (feeding.has(id)) return; feeding.add(id); const t = tasks.find((x) => x.nodeId === id); if (t) for (const d of depsOf(t.inputs)) visit(d) }
    for (const t of tasks) if (t.kind === 'videoShot' || t.kind === 'videoMerge') visit(t.nodeId)
    const dropped = tasks.filter((t) => !feeding.has(t.nodeId))
    if (dropped.length) warn(`この構成では動画だけを処理します（${dropped.map((t) => t.label).join('・')} の画像は作りません）`)
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
    t.input.__shot = { index: order.indexOf(t.nodeId), role: t.inputs.start?.kind === 'cut' ? t.inputs.start.role : null, endRole: t.inputs.end?.kind === 'cut' ? t.inputs.end.role : null, duration: Number(t.input.duration) || 0 }
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
      warn(`背景の Image Generation（${label}）はプロンプトが空のため対象外です（Text Prompt をつないでください）`)
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
  return { tasks, warnings }
}

/** タスクの入力の参照（画像・開始・終了） */
export function refsOf(inputs: TaskInputs | null | undefined): InputRef[] {
  return [inputs?.image, inputs?.start, inputs?.end].filter((r): r is InputRef => !!r)
}
/** 待つ前段のノード id（参照の dep と結合の入力） */
export function depsOf(inputs: TaskInputs | null | undefined): string[] {
  const out: string[] = []
  for (const r of refsOf(inputs)) if (r.kind === 'dep' && !out.includes(r.nodeId)) out.push(r.nodeId)
  for (const v of inputs?.videos ?? []) if (!out.includes(v)) out.push(v)
  return out
}

/** Video Generation の fal 入力（URL 以外）とメタ。比率 'auto' は Kling（3.0 以外）だけ投入時にアイテムの寸法から決める */
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
    ...(negative ? { negativePrompt: negative } : {}), ...(turned ? { cfgScale: END_CUT_CFG_SCALE } : {}),
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
  if (ref.kind === 'photo') return true
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
/** App の「カットを入れる」欄の構成: Cut Set Input のカットを始点にする Video Generation ごとに 1 ショット（結合のスロット順） */
export function shotsFromCanvas(snapshot: WorkflowSnapshot | null | undefined): VideoShotSpec[] {
  const snap = expandProductVideo(snapshot)
  const nodes = nodesOf(snap)
  const { tasks } = planTasks(snap)
  return tasks
    .filter((t) => t.kind === 'videoShot' && t.inputs.start?.kind === 'cut')
    .sort((a, b) => ((a.input.__shot as { index: number }).index - (b.input.__shot as { index: number }).index))
    .map((t) => {
      const s = t.input.__shot as { role: CutRole; endRole: CutRole | null; duration: number }
      const motion = str(nodes.find((n) => n.id === t.nodeId)?.data?.params?.prompt)
      return { role: s.role, duration: s.duration, motion, ...(s.endRole ? { endRole: s.endRole } : {}) }
    })
}
