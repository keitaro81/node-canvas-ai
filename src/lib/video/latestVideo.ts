// 動画の出どころの「今の動画」（2026-11-02 メモ 54）: Video Result・Reference Video・Video Merge は自分の videoUrl。
// Video Generation は自分では動画を持たず、生成のたびに右に Video Result を作ってそこに出すので、最後にできた Video Result の動画を使う
// （Video Generation → Video Merge / Export を直接つないだ形で、キャンバスの結合・書き出しがショットの動画を拾えなかった）
import { videoMergeSlotOf } from '../batch/plan'

interface NodeLike { id: string; type?: string; data?: unknown }
interface EdgeLike { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

const videoOfData = (d: unknown): string | null => {
  const v = (d as { videoUrl?: unknown } | undefined)?.videoUrl
  return typeof v === 'string' && v ? v : null
}

/** Video Generation の結果ノード（Video Result）を新しい順に（辺は作った順に並ぶ） */
export function videoResultsOf<N extends NodeLike>(nodeId: string, nodes: N[], edges: EdgeLike[]): N[] {
  const out: N[] = []
  const outs = edges.filter((e) => e.source === nodeId && (e.sourceHandle ?? 'out-video') === 'out-video')
  for (let i = outs.length - 1; i >= 0; i--) {
    const t = nodes.find((n) => n.id === outs[i].target)
    if (t?.type === 'videoDisplayNode' && !out.includes(t)) out.push(t)
  }
  return out
}

/** ノードの今の動画（無ければ null）。Video Generation は動画のある最新の Video Result */
export function latestVideoOf(nodeId: string, nodes: NodeLike[], edges: EdgeLike[]): string | null {
  const n = nodes.find((x) => x.id === nodeId)
  if (!n) return null
  const own = videoOfData(n.data)
  if (own) return own
  if (n.type !== 'videoGenerationNode') return null
  for (const r of videoResultsOf(nodeId, nodes, edges)) {
    const v = videoOfData(r.data)
    if (v) return v
  }
  return null
}

/** Video Merge の入力（スロット順）と、それぞれの今の動画 */
export function mergeInputsOf(mergeId: string, nodes: NodeLike[], edges: EdgeLike[]): Array<{ slot: number; sourceId: string; label: string; url: string | null }> {
  return edges
    .filter((e) => e.target === mergeId && videoMergeSlotOf(e.targetHandle) !== null)
    .map((e) => {
      const n = nodes.find((x) => x.id === e.source)
      const label = ((n?.data as { label?: unknown } | undefined)?.label as string | undefined) || e.source
      return { slot: videoMergeSlotOf(e.targetHandle)!, sourceId: e.source, label, url: latestVideoOf(e.source, nodes, edges) }
    })
    .sort((a, b) => a.slot - b.slot)
}
