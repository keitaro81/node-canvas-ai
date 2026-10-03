// 規定プロファイル（仕様 6 章・Step 8）: 撮影後工程のノード設定一式を 1 つの JSON として書き出し・読み込む。
// 書き出し = グラフから設定を集める。読み込み = 開いているグラフに「その場で」当てる（既存ノードは残して更新。バリアント名で突き合わせ）。
// 画面に依存しない純関数。ノードの id 生成は注入できる（テスト用）。
import type { BatchInputParams, CutoutParams, ExportParams, LayoutParams } from '../../types/nodes'
import { DEFAULT_BATCH_INPUT_PARAMS, normalizeBatchInputParams } from '../batch/items'
import { DEFAULT_CUTOUT_PARAMS, normalizeCutoutParams } from '../cutout/engines'
import { normalizeLayoutParams } from '../layout/computeLayout'
import { DEFAULT_EXPORT_PARAMS, normalizeExportParams } from '../export/naming'
import { addLayoutNodeToCanvas, cutoutSourceNodeId, removeLayoutNodeFromCanvas, updateLayoutNodeParams, type CanvasEdge, type CanvasFull, type CanvasLike, type CanvasNode } from '../review/model'
import { IMAGE_GEN_OUTPUT_HANDLE, LAYOUT_BACKGROUND_HANDLE, promptForGenerator, resolveBackgroundSource } from '../batch/background'

export const PROFILE_FORMAT = 'node-canvas-ai/postproduction-profile'
export const PROFILE_VERSION = 1
export const PROFILE_FILE_SUFFIX = '.ppprofile.json'

export interface ProfileBackground { key: string; model: string; prompt: string; aspectRatio: string; resolution: string; seed: number | null }
export type ProfileVariant = LayoutParams & { background: string | null }
export type ProfileCutout = Omit<CutoutParams, 'previewBg'>
export interface PostProductionProfile {
  format: typeof PROFILE_FORMAT
  version: number
  name: string
  exportedAt: string
  input: BatchInputParams
  cutout: ProfileCutout
  backgrounds: ProfileBackground[]
  variants: ProfileVariant[]
  export: ExportParams
}

// ───────────────────────── ハンドル・ノード型（キャンバスの定義と同じ値） ─────────────────────────
const H = {
  batchInputOut: 'out-image-image',
  rbIn: 'in-image-image',
  rbOut: 'out-cutout-cutout',
  layoutIn: 'in-cutout-cutout',
  layoutOut: 'out-image-image',
  layoutBg: LAYOUT_BACKGROUND_HANDLE,
  textOut: 'out-text-text-out',
  genTextIn: 'in-text',
  genOut: IMAGE_GEN_OUTPUT_HANDLE,
  exportIn: (i: number) => `in-image-${i}`,
}
const COLOR = { image: '#8B5CF6', text: '#6366F1', cutout: '#14B8A6' }
const DEFAULT_BG_MODEL = 'fal-ai/nano-banana-2'

type Data = Record<string, unknown>
const nodesOf = (c: CanvasLike | null | undefined): CanvasNode[] => (Array.isArray(c?.nodes) ? c!.nodes! : [])
const edgesOf = (c: CanvasLike | null | undefined): CanvasEdge[] => (Array.isArray(c?.edges) ? c!.edges! : [])
const typeOf = (n: CanvasNode | undefined): string | undefined => n?.data?.type as string | undefined
const paramsOf = (n: CanvasNode | undefined): Data => ((n?.data?.params as Data | undefined) ?? {})
const byPosition = (a: CanvasNode, b: CanvasNode) => ((a.position?.y ?? 0) - (b.position?.y ?? 0)) || ((a.position?.x ?? 0) - (b.position?.x ?? 0))

function cutoutOf(p: Data): ProfileCutout {
  const { previewBg: _pb, ...rest } = normalizeCutoutParams(p)
  return rest
}

// ───────────────────────── 書き出し ─────────────────────────

export function buildProfile(canvas: CanvasLike, name: string, now: Date = new Date()): { profile: PostProductionProfile; warnings: string[] } {
  const nodes = [...nodesOf(canvas)].sort(byPosition)
  const warnings: string[] = []
  const bi = nodes.find((n) => typeOf(n) === 'batchInput')
  const rbId = cutoutSourceNodeId(canvas)
  const rb = nodes.find((n) => n.id === rbId)
  const ex = nodes.find((n) => typeOf(n) === 'export')
  if (!rb) warnings.push('Remove Background ノードが無いため、切り抜きの設定は既定値になります')
  const layouts = nodes.filter((n) => typeOf(n) === 'productLayout')
  if (!layouts.length) warnings.push('Product Layout ノードが無いため、バリアントは空です')

  const backgrounds: ProfileBackground[] = []
  const keyByGenerator = new Map<string, string>()
  const variants: ProfileVariant[] = layouts.map((n) => {
    const params = normalizeLayoutParams(paramsOf(n))
    let background: string | null = null
    if (params.backgroundKind === 'image') {
      const src = resolveBackgroundSource(canvas, n.id)
      if (src?.generatorNodeId) {
        let key = keyByGenerator.get(src.generatorNodeId)
        if (!key) {
          const gen = nodes.find((x) => x.id === src.generatorNodeId)
          const gp = paramsOf(gen)
          // 読み込み時に覚えさせたキー（params.backgroundKey）があれば使い、無ければ bg_n
          const remembered = typeof gp.backgroundKey === 'string' && gp.backgroundKey.trim() ? gp.backgroundKey.trim() : null
          key = remembered && !backgrounds.some((b) => b.key === remembered) ? remembered : `bg_${backgrounds.length + 1}`
          keyByGenerator.set(src.generatorNodeId, key)
          const seedNum = Number(gp.seed)
          backgrounds.push({
            key,
            model: typeof gp.model === 'string' && gp.model ? gp.model : DEFAULT_BG_MODEL,
            prompt: promptForGenerator(canvas, src.generatorNodeId),
            aspectRatio: typeof gp.aspectRatio === 'string' && gp.aspectRatio ? gp.aspectRatio : '1:1',
            resolution: typeof gp.resolution === 'string' && gp.resolution ? gp.resolution : '1K',
            seed: gp.seed !== '' && gp.seed !== null && gp.seed !== undefined && Number.isFinite(seedNum) ? seedNum : null,
          })
        }
        background = key
      } else {
        warnings.push(`バリアント「${params.variantName}」の背景は生成ではない（固定画像か未接続）ため、プロファイルには含めません`)
      }
    }
    return { ...params, background }
  })
  for (const b of backgrounds) if (!b.prompt) warnings.push(`背景「${b.key}」のプロンプトが空です（Image Generation にテキストをつないでください）`)

  return {
    profile: {
      format: PROFILE_FORMAT,
      version: PROFILE_VERSION,
      name,
      exportedAt: now.toISOString(),
      input: bi ? normalizeBatchInputParams(paramsOf(bi)) : { ...DEFAULT_BATCH_INPUT_PARAMS },
      cutout: cutoutOf(rb ? paramsOf(rb) : {}),
      backgrounds,
      variants,
      export: ex ? normalizeExportParams(paramsOf(ex)) : { ...DEFAULT_EXPORT_PARAMS },
    },
    warnings,
  }
}

export function profileFileName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'profile'
  return `${base}${PROFILE_FILE_SUFFIX}`
}

// ───────────────────────── 読み込み（解析） ─────────────────────────

export type ParseResult = { ok: true; profile: PostProductionProfile; warnings: string[] } | { ok: false; error: string }

export function parseProfile(text: string): ParseResult {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { ok: false, error: 'JSON として読めません' } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'プロファイルの形式ではありません' }
  const r = raw as Data
  if (r.format !== PROFILE_FORMAT) return { ok: false, error: 'このアプリのプロファイルではありません（format が違います）' }
  const version = typeof r.version === 'number' ? r.version : NaN
  if (!Number.isFinite(version) || version < 1) return { ok: false, error: 'version がありません' }
  if (version > PROFILE_VERSION) return { ok: false, error: `新しい形式（version ${version}）です。アプリを更新してください` }
  const warnings: string[] = []

  const backgrounds: ProfileBackground[] = []
  const seenKeys = new Set<string>()
  for (const b of Array.isArray(r.backgrounds) ? (r.backgrounds as unknown[]) : []) {
    if (!b || typeof b !== 'object') continue
    const o = b as Data
    const key = typeof o.key === 'string' ? o.key.trim() : ''
    if (!key || seenKeys.has(key)) { warnings.push(`背景の key が無いか重複しているため飛ばしました（${key || '空'}）`); continue }
    seenKeys.add(key)
    const seedNum = Number(o.seed)
    backgrounds.push({
      key,
      model: typeof o.model === 'string' && o.model ? o.model : DEFAULT_BG_MODEL,
      prompt: typeof o.prompt === 'string' ? o.prompt : '',
      aspectRatio: typeof o.aspectRatio === 'string' && o.aspectRatio ? o.aspectRatio : '1:1',
      resolution: typeof o.resolution === 'string' && o.resolution ? o.resolution : '1K',
      seed: o.seed !== null && o.seed !== undefined && o.seed !== '' && Number.isFinite(seedNum) ? seedNum : null,
    })
  }

  const variants: ProfileVariant[] = []
  const names = new Set<string>()
  for (const v of Array.isArray(r.variants) ? (r.variants as unknown[]) : []) {
    if (!v || typeof v !== 'object') continue
    const o = v as Data
    const params = normalizeLayoutParams(o)
    let name = params.variantName
    if (names.has(name)) {
      let i = 2
      while (names.has(`${name}_${i}`)) i++
      warnings.push(`バリアント名「${name}」が重複しているため「${name}_${i}」にしました`)
      name = `${name}_${i}`
    }
    names.add(name)
    let background: string | null = typeof o.background === 'string' && o.background ? o.background : null
    if (background && !seenKeys.has(background)) { warnings.push(`バリアント「${name}」の背景「${background}」が backgrounds にありません`); background = null }
    variants.push({ ...params, variantName: name, background })
  }

  return {
    ok: true,
    warnings,
    profile: {
      format: PROFILE_FORMAT,
      version: PROFILE_VERSION,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'プロファイル',
      exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : '',
      input: normalizeBatchInputParams(r.input),
      cutout: cutoutOf((r.cutout as Data | undefined) ?? {}),
      backgrounds,
      variants,
      export: normalizeExportParams(r.export),
    },
  }
}

// ───────────────────────── 読み込み（グラフへ当てる） ─────────────────────────

export interface ImportSummary {
  updatedVariants: string[]
  addedVariants: string[]
  removedVariants: string[]
  addedBackgrounds: number
  createdNodes: string[]   // 新しく作ったノードの種類（表示用）
}
export interface ImportPlan { canvas: CanvasFull; summary: ImportSummary; warnings: string[] }

export type IdGen = (kind: string) => string
export const defaultIdGen: IdGen = (kind) => `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const edge = (source: string, sourceHandle: string, target: string, targetHandle: string, stroke: string): CanvasEdge =>
  ({ id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle, style: { stroke, strokeWidth: 2 }, animated: false, className: '' })

/** プロファイルを開いているグラフに当てる計画。Batch Input / Remove Background / Export は既存を更新（無ければ作る）、
 *  Product Layout はバリアント名で突き合わせて更新・追加・削除、背景は Image Generation（ジョブごと）＋ Text Prompt を作ってつなぐ */
export function planProfileImport(canvas: CanvasLike, profile: PostProductionProfile, idGen: IdGen = defaultIdGen): ImportPlan {
  const warnings: string[] = []
  const summary: ImportSummary = { updatedVariants: [], addedVariants: [], removedVariants: [], addedBackgrounds: 0, createdNodes: [] }
  let next: CanvasFull = { ...canvas, nodes: [...nodesOf(canvas)], edges: [...edgesOf(canvas)] }
  const original: CanvasFull = next
  const setParams = (id: string, params: Data) => {
    next = { ...next, nodes: next.nodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data ?? {}), params } } : n)) }
  }
  const addNode = (n: CanvasNode) => { next = { ...next, nodes: [...next.nodes, n] } }
  const addEdge = (e: CanvasEdge) => {
    if (next.edges.some((x) => x.source === e.source && x.sourceHandle === e.sourceHandle && x.target === e.target && x.targetHandle === e.targetHandle)) return
    next = { ...next, edges: [...next.edges, e] }
  }

  // 1) Batch Input
  let bi = next.nodes.find((n) => typeOf(n) === 'batchInput')
  if (bi) setParams(bi.id, { ...paramsOf(bi), ...profile.input })
  else {
    bi = { id: idGen('batchInput'), type: 'batchInputNode', position: { x: 40, y: 40 }, data: { type: 'batchInput', label: 'Batch Input', params: { ...profile.input }, status: 'idle', items: [], currentItemId: null } }
    addNode(bi); summary.createdNodes.push('Batch Input')
  }

  // 2) Remove Background（一括実行の切り抜きノード。無ければ最初の Remove Background、それも無ければ作る）
  const rbId = cutoutSourceNodeId(next)
  let rb = next.nodes.find((n) => n.id === rbId)
  if (rb) setParams(rb.id, { ...normalizeCutoutParams(paramsOf(rb)), ...profile.cutout })
  else {
    rb = { id: idGen('removeBackground'), type: 'removeBackgroundNode', position: { x: (bi.position?.x ?? 40) + 380, y: bi.position?.y ?? 40 }, data: { type: 'removeBackground', label: 'Remove Background', params: { ...DEFAULT_CUTOUT_PARAMS, ...profile.cutout }, status: 'idle' } }
    addNode(rb); summary.createdNodes.push('Remove Background')
  }
  addEdge(edge(bi.id, H.batchInputOut, rb.id, H.rbIn, COLOR.image))

  // 3) バリアント（Product Layout）: 名前で突き合わせ
  const existingLayouts = next.nodes.filter((n) => typeOf(n) === 'productLayout')
  const byName = new Map<string, CanvasNode>()
  for (const n of existingLayouts) { const name = normalizeLayoutParams(paramsOf(n)).variantName; if (!byName.has(name)) byName.set(name, n) }
  const layoutIdByVariant = new Map<string, string>()
  const matched = new Set<string>()
  for (const v of profile.variants) {
    const { background: _bg, ...params } = v
    const hit = byName.get(v.variantName)
    if (hit && !matched.has(hit.id)) {
      next = updateLayoutNodeParams(next, hit.id, normalizeLayoutParams(params))
      matched.add(hit.id); layoutIdByVariant.set(v.variantName, hit.id); summary.updatedVariants.push(v.variantName)
    } else {
      const r = addLayoutNodeToCanvas(next, normalizeLayoutParams(params), idGen('productLayoutNode'))
      next = r.canvas; layoutIdByVariant.set(v.variantName, r.nodeId); summary.addedVariants.push(v.variantName)
    }
  }
  for (const n of existingLayouts) {
    if (matched.has(n.id)) continue
    next = removeLayoutNodeFromCanvas(next, n.id)
    summary.removedVariants.push(normalizeLayoutParams(paramsOf(n)).variantName)
  }

  // 4) 背景（生成）: 同じモデル・プロンプトの Image Generation が元のグラフにあれば使い回し、無ければ Text Prompt + Image Generation を作る
  const generatorByKey = new Map<string, string>()
  const usedKeys = profile.variants.map((v) => v.background).filter((k): k is string => !!k)
  let bgRow = 0
  for (const key of Array.from(new Set(usedKeys))) {
    const bg = profile.backgrounds.find((b) => b.key === key)
    if (!bg) continue
    const reuse = nodesOf(original).find((n) => typeOf(n) === 'imageGen' && (paramsOf(n).model ?? DEFAULT_BG_MODEL) === bg.model && promptForGenerator(original, n.id) === bg.prompt)
    if (reuse) { generatorByKey.set(key, reuse.id); setParams(reuse.id, { ...paramsOf(reuse), executionScope: 'job', backgroundKey: key, aspectRatio: bg.aspectRatio, resolution: bg.resolution, seed: bg.seed === null ? '' : String(bg.seed) }); continue }
    const baseY = Math.max(0, ...next.nodes.map((n) => (n.position?.y ?? 0) + 400)) + bgRow * 460
    const textId = idGen('textPrompt'), genId = idGen('imageGen')
    addNode({ id: textId, type: 'textPromptNode', position: { x: 40, y: baseY }, data: { type: 'textPrompt', label: 'Text Prompt', params: { prompt: bg.prompt }, status: 'idle' } })
    addNode({ id: genId, type: 'imageGenerationNode', position: { x: 420, y: baseY }, data: { type: 'imageGen', label: `Image Generation（背景 ${key}）`, params: { model: bg.model, aspectRatio: bg.aspectRatio, resolution: bg.resolution, seed: bg.seed === null ? '' : String(bg.seed), executionScope: 'job', backgroundKey: key }, status: 'idle' } })
    addEdge(edge(textId, H.textOut, genId, H.genTextIn, COLOR.text))
    generatorByKey.set(key, genId)
    summary.addedBackgrounds++; summary.createdNodes.push(`背景 ${key}（Text Prompt + Image Generation）`)
    bgRow++
  }
  for (const v of profile.variants) {
    const layoutId = layoutIdByVariant.get(v.variantName)
    if (!layoutId) continue
    if (!v.background) {
      if (v.backgroundKind === 'image' && !resolveBackgroundSource(next, layoutId)) warnings.push(`バリアント「${v.variantName}」は背景が「画像」ですが背景入力が無いため、単色の既定で描かれます`)
      continue
    }
    const genId = generatorByKey.get(v.background)
    if (!genId) continue
    const cur = resolveBackgroundSource(next, layoutId)
    if (cur?.generatorNodeId === genId) continue   // すでにこの生成器（結果ノード経由を含む）につながっている
    next = { ...next, edges: next.edges.filter((e) => !(e.target === layoutId && e.targetHandle === H.layoutBg)) }
    addEdge(edge(genId, H.genOut, layoutId, H.layoutBg, COLOR.image))
  }

  // 5) Export: 既存を更新（無ければ作る）。新しいバリアントは空きスロットにつなぐ
  let ex = next.nodes.find((n) => typeOf(n) === 'export')
  if (ex) setParams(ex.id, { ...paramsOf(ex), ...profile.export })
  else {
    const layouts = next.nodes.filter((n) => typeOf(n) === 'productLayout')
    const maxX = Math.max((rb.position?.x ?? 420) + 380, ...layouts.map((n) => (n.position?.x ?? 0) + 380))
    ex = { id: idGen('export'), type: 'exportNode', position: { x: maxX, y: layouts[0]?.position?.y ?? (rb.position?.y ?? 40) }, data: { type: 'export', label: 'Export', params: { ...profile.export }, status: 'idle' } }
    addNode(ex); summary.createdNodes.push('Export')
  }
  const exId = ex.id
  const connectedLayouts = new Set(next.edges.filter((e) => e.target === exId && (e.targetHandle ?? '').startsWith('in-image-')).map((e) => e.source))
  const usedSlots = new Set(next.edges.filter((e) => e.target === exId && (e.targetHandle ?? '').startsWith('in-image-')).map((e) => Number((e.targetHandle ?? '').slice('in-image-'.length))))
  let slot = 0
  for (const v of profile.variants) {
    const layoutId = layoutIdByVariant.get(v.variantName)
    if (!layoutId || connectedLayouts.has(layoutId)) continue
    while (usedSlots.has(slot)) slot++
    if (slot >= 10) break
    usedSlots.add(slot)
    addEdge(edge(layoutId, H.layoutOut, exId, H.exportIn(slot), COLOR.image))
  }

  return { canvas: next, summary, warnings }
}

/** 確認ダイアログ用の要約文 */
export function describeImport(summary: ImportSummary): string[] {
  const lines: string[] = []
  if (summary.updatedVariants.length) lines.push(`バリアントを更新: ${summary.updatedVariants.join(', ')}`)
  if (summary.addedVariants.length) lines.push(`バリアントを追加: ${summary.addedVariants.join(', ')}`)
  if (summary.removedVariants.length) lines.push(`バリアントを削除: ${summary.removedVariants.join(', ')}`)
  if (summary.addedBackgrounds) lines.push(`背景生成を追加: ${summary.addedBackgrounds} 件`)
  if (summary.createdNodes.length) lines.push(`作成するノード: ${summary.createdNodes.join('、')}`)
  if (!lines.length) lines.push('設定の更新だけです（ノードの追加・削除はありません）')
  return lines
}
