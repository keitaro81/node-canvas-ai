// List ノードの中身（スロット順・空のスロットは飛ばす）。Video Generation のリスト（2026-11-02 メモ 40: 動画・画像・テキストの 3 種類）で使う。
// 動画 → 参照動画、画像 → 開始フレーム、テキスト → 動きの指示として、項目ごとに 1 本ずつ作る
import { getImageUrlFromNodeData } from './utils'

export type ListMode = 'image' | 'text' | 'video' | 'unset'

interface NodeLike { id: string; data?: unknown }
interface EdgeLike { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

const textOf = (d: Record<string, unknown>): string | null => {
  const out = d.outputText
  if (typeof out === 'string' && out.trim()) return out.trim()
  const p = (d.params as Record<string, unknown> | undefined)?.prompt
  return typeof p === 'string' && p.trim() ? p.trim() : null
}
const videoOf = (d: Record<string, unknown>): string | null => (typeof d.videoUrl === 'string' && d.videoUrl ? d.videoUrl : null)

/** List ノードの項目（スロット順）。mode は List ノードのモード（未確定は 'unset' で項目なし） */
export function listItemsOf(nodes: NodeLike[], edges: EdgeLike[], listNodeId: string | null | undefined): { mode: ListMode; items: string[] } {
  const list = listNodeId ? nodes.find((n) => n.id === listNodeId) : undefined
  if (!list) return { mode: 'unset', items: [] }
  const d = (list.data ?? {}) as { mode?: ListMode; slotCount?: number }
  const mode: ListMode = d.mode === 'image' || d.mode === 'text' || d.mode === 'video' ? d.mode : 'unset'
  if (mode === 'unset') return { mode, items: [] }
  const prefix = mode === 'image' ? 'in-image-' : mode === 'text' ? 'in-text-' : 'in-video-'
  const slots = Math.max(1, d.slotCount ?? 1)
  const items: string[] = []
  for (let i = 0; i < slots; i++) {
    const e = edges.find((x) => x.target === list.id && x.targetHandle === `${prefix}${i}`)
    const src = e ? nodes.find((n) => n.id === e.source) : undefined
    if (!src) continue
    const sd = (src.data ?? {}) as Record<string, unknown>
    const v = mode === 'image' ? getImageUrlFromNodeData(sd, e?.sourceHandle) : mode === 'text' ? textOf(sd) : videoOf(sd)
    if (v) items.push(v)
  }
  return { mode, items }
}
