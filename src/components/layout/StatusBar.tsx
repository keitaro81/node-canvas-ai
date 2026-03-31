import { useCanvasStore } from '../../stores/canvasStore'

export function StatusBar() {
  const { zoom, nodes, edges } = useCanvasStore()
  const zoomPct = Math.round(zoom * 100)

  return (
    <footer
      className="flex items-center justify-between shrink-0 px-4 border-t border-[#27272A]"
      style={{ height: 28, background: '#111113' }}
    >
      {/* Left: zoom */}
      <span className="text-[11px] text-[#71717A] tabular-nums">
        {zoomPct}%
      </span>

      {/* Right: counts */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-[#71717A]">
          <span className="text-[#A1A1AA]">{nodes.length}</span> nodes
        </span>
        <span className="text-[#27272A]">·</span>
        <span className="text-[11px] text-[#71717A]">
          <span className="text-[#A1A1AA]">{edges.length}</span> connections
        </span>
      </div>
    </footer>
  )
}
