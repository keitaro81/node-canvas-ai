// ReviewGrid（仕様 5 章）の純関数: 写しからバリアント/切り抜き/書き出し設定を取り出す、識別値の入力、絞り込み、キーボード移動、書き出し計画。
import type { BatchItemInfo, CutoutParams, ExportParams, LayoutParams } from '../../types/nodes'
import type { BatchItemRow, BatchJobDetail, BatchTaskRow } from '../../types/batch'
import { normalizeLayoutParams } from '../layout/computeLayout'
import { normalizeCutoutParams } from '../cutout/engines'
import type { LayoutIdentityInput } from '../layout/identity'
import { normalizeExportParams, planExportEntries, sanitizeFileName, dateToken, type PlannedEntry } from '../export/naming'
import { stripExtension } from '../batch/items'

export type Snapshot = BatchJobDetail['workflow_snapshot']

/** 切り抜きプレビュー列（透過のまま。表示背景の切替が効く） */
export const CUTOUT_VARIANT_KEY = '__cutout'
export const THUMB_MAX_EDGE = 400

export interface ReviewVariant {
  key: string                      // Product Layout ノード ID、または追加バリアントの 'added-N'（記録・サムネイル名にも使う）
  name: string                     // variantName（表示・書き出しファイル名）
  params: LayoutParams             // 上書き ?? 写し
  baseParams: LayoutParams         // 写し（投入時）の設定
  overridden: boolean
  added: boolean                   // ジョブ画面で後から追加したバリアント（写しには無い。再実行不要）
  backgroundNodeId: string | null  // 背景画像入力につながるノード（ジョブごとタスクの結果を使う。Step 8）
}

/** layout_overrides の中で、追加バリアントを持つキー */
export const ADDED_VARIANTS_KEY = '__added'
export interface AddedVariant { key: string; params: LayoutParams }

/** 上書き設定から追加バリアントを取り出す（形が崩れていれば無視） */
export function addedVariantsOf(overrides: Record<string, unknown> | null | undefined): AddedVariant[] {
  const raw = overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>)[ADDED_VARIANTS_KEY] : undefined
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a): a is { key: string; params: unknown } => !!a && typeof a === 'object' && typeof (a as { key?: unknown }).key === 'string' && /^added-\d+$/.test((a as { key: string }).key))
    .map((a) => ({ key: a.key, params: normalizeLayoutParams(a.params) }))
}

export function newVariantKey(existingKeys: string[]): string {
  let n = 1
  while (existingKeys.includes(`added-${n}`)) n++
  return `added-${n}`
}

const nodesOf = (s: Snapshot | null | undefined) => (Array.isArray(s?.nodes) ? s!.nodes! : [])
const edgesOf = (s: Snapshot | null | undefined) => (Array.isArray(s?.edges) ? s!.edges! : [])

/** 写しの Product Layout ノード＝バリアント。ジョブの上書き設定があればそれを使う */
export function variantsFromSnapshot(snapshot: Snapshot | null | undefined, overrides: Record<string, unknown> | null | undefined): ReviewVariant[] {
  const edges = edgesOf(snapshot)
  const fromSnapshot = nodesOf(snapshot)
    .filter((n) => n?.data?.type === 'productLayout')
    .map((n): ReviewVariant => {
      const baseParams = normalizeLayoutParams(n.data?.params)
      const ov = overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>)[n.id] : undefined
      const params = ov && typeof ov === 'object' ? normalizeLayoutParams({ ...baseParams, ...(ov as Record<string, unknown>) }) : baseParams
      const bgEdge = edges.find((e) => e.target === n.id && e.targetHandle === 'in-image-background')
      return { key: n.id, name: params.variantName, params, baseParams, overridden: !!ov, added: false, backgroundNodeId: bgEdge?.source ?? null }
    })
  // ジョブ画面で後から追加したバリアント（写しは変えない。切り抜きの再実行は不要）
  const added = addedVariantsOf(overrides).map((a): ReviewVariant => ({ key: a.key, name: a.params.variantName, params: a.params, baseParams: a.params, overridden: false, added: true, backgroundNodeId: null }))
  return [...fromSnapshot, ...added]
}

/** 写しの切り抜きノード（Batch Input に直結しているもの＝一括実行の対象。サーバーの planTasks と同じ規則） */
export function cutoutNodesFromSnapshot(snapshot: Snapshot | null | undefined): Array<{ nodeId: string; params: CutoutParams }> {
  const nodes = nodesOf(snapshot)
  const edges = edgesOf(snapshot)
  const batchInputIds = new Set(nodes.filter((n) => n?.data?.type === 'batchInput').map((n) => n.id))
  return nodes
    .filter((n) => n?.data?.type === 'removeBackground')
    .filter((n) => { const feed = edges.find((e) => e.target === n.id && e.targetHandle === 'in-image-image'); return !!feed && batchInputIds.has(feed.source) })
    .map((n) => ({ nodeId: n.id, params: normalizeCutoutParams(n.data?.params) }))
}

/** 写しの Export ノードの設定（無ければ既定） */
export function exportParamsFromSnapshot(snapshot: Snapshot | null | undefined): ExportParams {
  const n = nodesOf(snapshot).find((x) => x?.data?.type === 'export')
  return normalizeExportParams(n?.data?.params)
}

/** タスクに再実行時の設定（input.__params）があればそれ、無ければ写しの設定 */
export function cutoutParamsOf(task: BatchTaskRow | null | undefined, fallback: CutoutParams): CutoutParams {
  const p = task?.input?.__params
  return p && typeof p === 'object' ? normalizeCutoutParams(p) : fallback
}

/** 結果ファイルの種類（BiRefNet はマスク、Bria は透過画像） */
export function resultKindOf(task: Pick<BatchTaskRow, 'endpoint' | 'result_meta'>): 'mask' | 'rgba' {
  const k = task.result_meta?.kind
  if (k === 'mask' || k === 'rgba') return k
  return task.endpoint.startsWith('fal-ai/birefnet') ? 'mask' : 'rgba'
}

/** 同じパスに結果が上書きされる（再実行）ため、識別値には完了時刻（またはリクエスト ID）を混ぜる */
export function maskVersionOf(task: Pick<BatchTaskRow, 'completed_at' | 'result_meta' | 'id'>): string {
  return task.completed_at ?? task.result_meta?.falRequestId ?? task.id
}

export const thumbKey = (itemId: string, variantKey: string): string => `${itemId}|${variantKey}`

const safeSeg = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'v'

/** サムネイルの保存名（識別値の先頭 12 桁）。透過は PNG、それ以外は JPEG */
export function thumbFileName(variantKey: string, hash: string, transparent: boolean): string {
  const v = variantKey === CUTOUT_VARIANT_KEY ? 'cutout' : safeSeg(variantKey)
  return `thumb-${v}-${hash.slice(0, 12)}.${transparent ? 'png' : 'jpg'}`
}

export function itemInfoOfRow(item: Pick<BatchItemRow, 'sku' | 'original_filename' | 'sort_order'>): BatchItemInfo {
  return { sku: item.sku, original: stripExtension(item.original_filename), index: item.sort_order }
}

/** レイアウト識別値の入力（バリアント）。切り抜き列はレイアウト設定を持たないので params は固定の印だけ */
export function identityFor(input: {
  item: Pick<BatchItemRow, 'source_path' | 'interactive_path'>
  task: Pick<BatchTaskRow, 'result_path' | 'completed_at' | 'result_meta' | 'id'>
  cutout: Pick<CutoutParams, 'alphaThreshold' | 'featherPx'>
  params: LayoutParams
  backgroundRef?: string | null
}): LayoutIdentityInput {
  return {
    params: input.params,
    sourceRef: input.item.source_path ?? input.item.interactive_path ?? '',
    maskPath: input.task.result_path ?? '',
    maskVersion: maskVersionOf(input.task),
    alphaThreshold: input.cutout.alphaThreshold,
    featherPx: input.cutout.featherPx,
    backgroundRef: input.backgroundRef ?? null,
  }
}

/** 切り抜き列用のダミー設定（透過・余白なし・正方形は使わない。識別値の区別のためだけに固定値を入れる） */
export const CUTOUT_PREVIEW_PARAMS: LayoutParams = normalizeLayoutParams({ variantName: '__cutout', backgroundKind: 'transparent', width: 16, height: 16, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 })

// ───────────────────────── 投入元ワークフロー（canvas_data）との連動 ─────────────────────────
// バリアント = ワークフローの Product Layout ノード。Jobs 画面での追加・削除・変更はノードを書き換える（本人のワークフローのみ）。

export interface CanvasNode { id: string; type?: string; position?: { x: number; y: number }; data?: Record<string, unknown>; [k: string]: unknown }
export interface CanvasEdge { id?: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null; [k: string]: unknown }
export interface CanvasLike { nodes?: CanvasNode[]; edges?: CanvasEdge[]; [k: string]: unknown }
export type CanvasFull = CanvasLike & { nodes: CanvasNode[]; edges: CanvasEdge[] }

const CUTOUT_OUT_HANDLE = 'out-cutout-cutout'
const LAYOUT_IN_HANDLE = 'in-cutout-cutout'
const LAYOUT_NODE_TYPE = 'productLayoutNode'
const LAYOUT_NODE_W = 300
const LAYOUT_NODE_GAP = 720

/** 一括実行の切り抜きノード（Batch Input に直結した Remove Background）。無ければ最初の Remove Background */
export function cutoutSourceNodeId(canvas: CanvasLike | null | undefined): string | null {
  const nodes = Array.isArray(canvas?.nodes) ? canvas!.nodes! : []
  const fed = cutoutNodesFromSnapshot(canvas as Snapshot)[0]?.nodeId
  return fed ?? nodes.find((n) => n?.data?.type === 'removeBackground')?.id ?? null
}

export function newLayoutNodeId(): string {
  return `${LAYOUT_NODE_TYPE}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Product Layout ノードを追加し、切り抜きノードにつなぐ。位置は既存のレイアウトノードの下（無ければ切り抜きノードの右） */
export function addLayoutNodeToCanvas(canvas: CanvasLike, params: LayoutParams, nodeId = newLayoutNodeId()): { canvas: CanvasFull; nodeId: string } {
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
  const edges = Array.isArray(canvas.edges) ? canvas.edges : []
  const layouts = nodes.filter((n) => n?.data?.type === 'productLayout')
  const srcId = cutoutSourceNodeId(canvas)
  const src = nodes.find((n) => n.id === srcId)
  let position = { x: 760, y: 40 }
  if (layouts.length) {
    const lowest = layouts.reduce((a, b) => ((b.position?.y ?? 0) > (a.position?.y ?? 0) ? b : a))
    position = { x: lowest.position?.x ?? 760, y: (lowest.position?.y ?? 0) + LAYOUT_NODE_GAP }
  } else if (src?.position) {
    position = { x: src.position.x + LAYOUT_NODE_W + 80, y: src.position.y }
  }
  const node: CanvasNode = { id: nodeId, type: LAYOUT_NODE_TYPE, position, data: { type: 'productLayout', label: 'Product Layout', params: { ...params }, status: 'idle' } }
  const newEdges = srcId
    ? [...edges, { id: `e-${srcId}-${nodeId}`, source: srcId, sourceHandle: CUTOUT_OUT_HANDLE, target: nodeId, targetHandle: LAYOUT_IN_HANDLE, style: { stroke: '#14B8A6', strokeWidth: 2 }, animated: false, className: '' }]
    : edges
  return { canvas: { ...canvas, nodes: [...nodes, node], edges: newEdges }, nodeId }
}

/** Product Layout ノードを削除し、そのノードにつながる辺も外す */
export function removeLayoutNodeFromCanvas(canvas: CanvasLike, nodeId: string): CanvasFull {
  const nodes = (Array.isArray(canvas.nodes) ? canvas.nodes : []).filter((n) => n.id !== nodeId)
  const edges = (Array.isArray(canvas.edges) ? canvas.edges : []).filter((e) => e.source !== nodeId && e.target !== nodeId)
  return { ...canvas, nodes, edges }
}

/** Product Layout ノードのパラメータを差し替える */
export function updateLayoutNodeParams(canvas: CanvasLike, nodeId: string, params: LayoutParams): CanvasFull {
  const nodes = (Array.isArray(canvas.nodes) ? canvas.nodes : []).map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data ?? {}), params: { ...params } } } : n))
  return { ...canvas, nodes, edges: Array.isArray(canvas.edges) ? canvas.edges : [] }
}

/** 書き出しの対象バリアント。レイアウトノードが無いジョブでは切り抜き（透過 PNG）を 'cutout' として書き出す */
export function exportVariantsOf(variants: ReviewVariant[]): ReviewVariant[] {
  if (variants.length) return variants
  const params = normalizeLayoutParams({ ...CUTOUT_PREVIEW_PARAMS, variantName: 'cutout' })
  return [{ key: CUTOUT_VARIANT_KEY, name: 'cutout', params, baseParams: params, overridden: false, added: false, backgroundNodeId: null }]
}

export type ReviewFilter = 'all' | 'ok' | 'ng' | 'unreviewed' | 'failed'

export function filterItems<T extends Pick<BatchItemRow, 'review' | 'status'>>(items: T[], f: ReviewFilter): T[] {
  if (f === 'all') return items
  if (f === 'failed') return items.filter((i) => i.status === 'failed')
  return items.filter((i) => i.review === f)
}

export interface GridSelection { row: number; col: number }

/** 矢印キーでの移動（範囲内に収める）。cols は列数（切り抜き列を含む） */
export function moveSelection(sel: GridSelection | null, key: string, rows: number, cols: number): GridSelection | null {
  if (rows <= 0 || cols <= 0) return null
  const cur = sel ?? { row: 0, col: 0 }
  let { row, col } = cur
  if (key === 'ArrowUp') row--
  else if (key === 'ArrowDown') row++
  else if (key === 'ArrowLeft') col--
  else if (key === 'ArrowRight') col++
  else if (key === 'Home') row = 0
  else if (key === 'End') row = rows - 1
  else return sel
  return { row: Math.min(rows - 1, Math.max(0, row)), col: Math.min(cols - 1, Math.max(0, col)) }
}

export interface ExportPlanItem { item: BatchItemRow; entries: PlannedEntry[]; warnings: string[] }

/** ジョブの書き出し計画（アイテムごとに命名規則を適用。連番はアイテムの並び順） */
export function planJobExport(items: BatchItemRow[], variants: ReviewVariant[], params: ExportParams, now: Date): ExportPlanItem[] {
  const inputs = variants.map((v) => ({ variant: v.name, transparent: v.params.backgroundKind === 'transparent' }))
  return items.map((item) => {
    const { entries, warnings } = planExportEntries(inputs, params, itemInfoOfRow(item), now)
    return { item, entries, warnings }
  })
}

export function jobZipName(jobName: string, now: Date): string {
  return sanitizeFileName(`${jobName.trim() || 'job'}_${dateToken(now)}.zip`)
}

/** ZIP の概算サイズ（警告の目安。JPEG ≈ 0.25 byte/px、PNG ≈ 1.2 byte/px、WebP ≈ 0.15 byte/px） */
export function estimateZipBytes(count: number, width: number, height: number, format: ExportParams['format']): number {
  const perPx = format === 'png' ? 1.2 : format === 'webp' ? 0.15 : 0.25
  return Math.round(count * width * height * perPx)
}
