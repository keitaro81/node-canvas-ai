// ノードが組み済みのテンプレート（2026-10-31・設計 docs/specs/product-video-nodes.md §8）。My Projects の「テンプレートから作成」で新しいワークフローにする。
// 商品動画の 3 構成（EC 標準 15 秒 / ターンテーブル 12 秒 / ショート 9 秒）は、旧 Product Video ノードの展開と同じ関数で
// Cut Set Input → Video Generation × ショット → Video Merge → Export に組む（旧ノードのプリセットの置き場がここになる）
import { VIDEO_TEMPLATES, templateById, totalSeconds } from '../video/productVideo'
import { expandProductVideoNode, type SnapshotEdge, type SnapshotNode } from '../batch/plan'
import { DEFAULT_EXPORT_PARAMS } from '../export/naming'

export interface TemplateCanvas { nodes: SnapshotNode[]; edges: SnapshotEdge[]; viewport: null }
export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  kind: 'video'
  shots: number
  seconds: number
  build: () => TemplateCanvas
}

const shotIndexOf = (id: string): number | null => { const m = /^pv:shot:(\d+)$/.exec(id); return m ? Number(m[1]) : null }
const renameId = (id: string): string => {
  if (id === 'pv:cuts') return 'cut-set'
  if (id === 'pv:base') return 'base-prompt'
  if (id === 'pv') return 'merge'
  const i = shotIndexOf(id)
  return i === null ? id : `shot-${i + 1}`
}

/** 商品動画のテンプレート（VIDEO_TEMPLATES の id）からキャンバスを組む。id は読みやすい固定名（cut-set / base-prompt / shot-N / merge / export） */
export function buildProductVideoTemplate(templateId: string): TemplateCanvas {
  const tpl = templateById(templateId)
  if (!tpl) throw new Error(`unknown template: ${templateId}`)
  const x = 80, y = 80
  const ex = expandProductVideoNode({ id: 'pv', type: 'productVideoNode', position: { x, y }, data: { type: 'productVideo', label: '商品動画', params: { templateId }, status: 'idle' } })
  const nodes: SnapshotNode[] = ex.nodes.map((n) => {
    const i = shotIndexOf(n.id)
    const label = i !== null ? String(n.data?.label ?? '').replace(/^商品動画 /, 'ショット ') : n.id === 'pv' ? 'Video Merge' : n.data?.label
    return { ...n, id: renameId(n.id), data: { ...n.data, label } }
  })
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): SnapshotEdge => ({ id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle })
  const edges: SnapshotEdge[] = ex.edges.map((e) => edge(renameId(e.source), e.sourceHandle ?? '', renameId(e.target), e.targetHandle ?? ''))
  // 書き出し（結合した動画 + アイテム情報）
  nodes.push({ id: 'export', type: 'exportNode', position: { x: x + 1240, y }, data: { type: 'export', label: 'Export', params: { ...DEFAULT_EXPORT_PARAMS }, status: 'idle' } })
  edges.push(edge('merge', 'out-video', 'export', 'in-video-v0'))
  edges.push(edge('cut-set', 'out-item-item', 'export', 'in-item-item'))
  return { nodes, edges, viewport: null }
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = VIDEO_TEMPLATES.map((t) => ({
  id: `video-${t.id}`,
  name: `商品動画: ${t.label}`,
  description: t.description,
  kind: 'video',
  shots: t.shots.length,
  seconds: totalSeconds(t.shots),
  build: () => buildProductVideoTemplate(t.id),
}))

export const templateOf = (id: string): WorkflowTemplate | null => WORKFLOW_TEMPLATES.find((t) => t.id === id) ?? null
