import { useCanvasStore } from '../../stores/canvasStore'

export function StatusBar() {
  const { zoom, nodes, edges } = useCanvasStore()
  const zoomPct = Math.round(zoom * 100)

  return (
    <footer
      className="flex items-center justify-between shrink-0 px-4 border-t border-[var(--border)]"
      style={{ height: 28, background: 'var(--bg-surface)' }}
    >
      {/* Left: zoom */}
      <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
        {zoomPct}%
      </span>

      {/* Right: counts */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-[var(--text-tertiary)]">
          <span className="text-[var(--text-secondary)]">{nodes.length}</span> nodes
        </span>
        <span className="text-[var(--border)]">·</span>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          <span className="text-[var(--text-secondary)]">{edges.length}</span> connections
        </span>
      </div>
    </footer>
  )
}
