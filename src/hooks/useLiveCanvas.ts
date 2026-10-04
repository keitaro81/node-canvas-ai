// キャンバスの「現在のノード」を、位置の変化を除いた署名でデバウンスして返す（一括結果ノード / App モードの結果欄が
// バリアント・背景・Export 設定の出どころにする。Product Layout のスライダー操作中に描き直しが連打されないように 400ms 落ち着かせる）
import { useMemo, useRef, useState, useEffect } from 'react'
import { useCanvasStore } from '../stores/canvasStore'
import type { CanvasLike } from '../lib/review/model'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export function useLiveCanvas(debounceMs = 400): CanvasLike {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const latest = useRef({ nodes, edges })
  latest.current = { nodes, edges }
  const signature = useMemo(() => JSON.stringify({
    n: nodes.map((n) => { const d = n.data as unknown as Record<string, unknown>; return [n.id, n.type, d.type, d.params ?? null, typeof d.output === 'string' ? d.output : null, typeof d.imageUrl === 'string' ? d.imageUrl : null] }),
    e: edges.map((e) => [e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null]),
  }), [nodes, edges])
  const settled = useDebounced(signature, debounceMs)
  return useMemo<CanvasLike>(() => ({
    nodes: latest.current.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data as unknown as Record<string, unknown> })),
    edges: latest.current.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [settled])
}
