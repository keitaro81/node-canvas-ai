// Video Generation につないだ入力の種類（参照動画・開始フレームの画像）。ノードと App の欄で同じ判定（2026-11-02 メモ 57）
import { listItemsOf } from '../listItems'
import type { VideoInputKind } from '../ai/videoModels'

interface NodeLike { id: string; data?: unknown }
interface EdgeLike { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

export function videoGenInputOf(nodeId: string, nodes: NodeLike[], edges: EdgeLike[]): VideoInputKind {
  const into = edges.filter((e) => e.target === nodeId)
  const videoEdge = into.find((e) => e.targetHandle === 'in-video')
  const videoSrc = videoEdge ? nodes.find((n) => n.id === videoEdge.source) : undefined
  const hasVideo = typeof (videoSrc?.data as { videoUrl?: unknown } | undefined)?.videoUrl === 'string' && !!(videoSrc!.data as { videoUrl: string }).videoUrl
  const listEdge = into.find((e) => e.targetHandle === 'in-list')
  const list = listEdge ? listItemsOf(nodes, edges, listEdge.source) : { mode: 'unset' as const, items: [] }
  return {
    video: hasVideo || list.mode === 'video',
    image: into.some((e) => e.targetHandle === 'in-image') || list.mode === 'image',
  }
}
