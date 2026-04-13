import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { List, Plus, Minus, X, ImageIcon, Type } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { getImageUrlFromNodeData } from '../../lib/utils'
import type { ListNodeData } from '../../types/nodes'

// Layout constants (must match rendered DOM layout for handle alignment)
const HEADER_HEIGHT = 36
const BODY_PADDING_TOP = 12  // mode toggle row height (approx)
const MODE_TOGGLE_HEIGHT = 28 // px — mode toggle row
const SLOT_HEIGHT = 40
const SLOT_GAP = 8

/** Vertical center of slot i from node top */
function slotHandleTop(i: number): number {
  return HEADER_HEIGHT + BODY_PADDING_TOP + MODE_TOGGLE_HEIGHT + BODY_PADDING_TOP + i * (SLOT_HEIGHT + SLOT_GAP) + SLOT_HEIGHT / 2
}

const IMAGE_HANDLE_STYLE = {
  width: 20,
  height: 20,
  background: 'radial-gradient(circle, #8B5CF6 3px, var(--bg-surface) 3px 5px, transparent 5px)',
  border: 'none',
  borderRadius: 0,
} as const

const TEXT_HANDLE_STYLE = {
  width: 20,
  height: 20,
  background: 'radial-gradient(circle, #6366F1 3px, var(--bg-surface) 3px 5px, transparent 5px)',
  border: 'none',
  borderRadius: 0,
} as const

function getTextFromData(data: Record<string, unknown>): string | null {
  return (data.outputText as string) || ((data.params as Record<string, unknown> | undefined)?.prompt as string) || null
}

function ListNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ListNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const storeNodes = useCanvasStore((s) => s.nodes)
  const storeEdges = useCanvasStore((s) => s.edges)

  const slotCount = Math.max(1, nodeData.slotCount ?? 1)
  const mode = nodeData.mode ?? 'unset'

  // スロットごとの接続状態を収集
  const slotContents: ({ type: 'image'; url: string } | { type: 'text'; text: string } | null)[] =
    Array(slotCount).fill(null)

  storeEdges
    .filter((e) => e.target === id && e.targetHandle?.startsWith('in-image-'))
    .forEach((e) => {
      const i = parseInt(e.targetHandle!.replace('in-image-', ''), 10)
      if (i >= 0 && i < slotCount) {
        const src = storeNodes.find((n) => n.id === e.source)
        if (src) {
          const url = getImageUrlFromNodeData(src.data)
          if (url) slotContents[i] = { type: 'image', url }
        }
      }
    })

  storeEdges
    .filter((e) => e.target === id && e.targetHandle?.startsWith('in-text-'))
    .forEach((e) => {
      const i = parseInt(e.targetHandle!.replace('in-text-', ''), 10)
      if (i >= 0 && i < slotCount) {
        const src = storeNodes.find((n) => n.id === e.source)
        if (src) {
          const text = getTextFromData(src.data as Record<string, unknown>)
          slotContents[i] = { type: 'text', text: text ?? '' }
        }
      }
    })

  /** モード変更: 既存スロット接続をすべてクリアしてからモード更新 */
  function switchMode(newMode: 'image' | 'text') {
    if (newMode === mode) return
    const { setEdges, edges } = useCanvasStore.getState()
    setEdges(edges.filter(
      (e) => !(e.target === id && (e.targetHandle?.startsWith('in-image-') || e.targetHandle?.startsWith('in-text-')))
    ))
    updateNode(id, { mode: newMode } as Partial<ListNodeData>)
  }

  function addSlot() {
    updateNode(id, { slotCount: slotCount + 1 } as Partial<ListNodeData>)
  }

  function removeSlot() {
    if (slotCount <= 1) return
    const { setEdges, edges } = useCanvasStore.getState()
    const lastImg = `in-image-${slotCount - 1}`
    const lastTxt = `in-text-${slotCount - 1}`
    setEdges(edges.filter((e) => !(e.target === id && (e.targetHandle === lastImg || e.targetHandle === lastTxt))))
    updateNode(id, { slotCount: slotCount - 1 } as Partial<ListNodeData>)
  }

  // unset 時はどちらの種類のハンドルも描画（最初の接続でモード確定）
  const showImageHandles = mode === 'image' || mode === 'unset'
  const showTextHandles = mode === 'text' || mode === 'unset'

  return (
    <div className="group">
      <div
        className={[
          'node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible border transition-all duration-150',
          selected
            ? 'border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
            : 'border-[var(--border)]',
        ].join(' ')}
        style={{ background: 'var(--bg-surface)' }}
      >
        {/* Input handles */}
        {showImageHandles && Array.from({ length: slotCount }).map((_, i) => (
          <Handle
            key={`in-image-${i}`}
            id={`in-image-${i}`}
            type="target"
            position={Position.Left}
            style={{ ...IMAGE_HANDLE_STYLE, position: 'absolute', top: slotHandleTop(i), left: mode === 'unset' ? -14 : -10 }}
          />
        ))}
        {showTextHandles && Array.from({ length: slotCount }).map((_, i) => (
          <Handle
            key={`in-text-${i}`}
            id={`in-text-${i}`}
            type="target"
            position={Position.Left}
            style={{ ...TEXT_HANDLE_STYLE, position: 'absolute', top: slotHandleTop(i), left: mode === 'unset' ? -10 : -10 }}
          />
        ))}

        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]"
          style={{ minHeight: HEADER_HEIGHT }}
        >
          <div className="w-0.5 h-4 rounded-full shrink-0" style={{ background: '#8B5CF6' }} />
          <List size={14} className="shrink-0" style={{ color: '#8B5CF6' }} />
          <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">
            {nodeData.label}
          </span>
          <button
            className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag"
            style={{ color: 'var(--text-tertiary)' }}
            onClick={() => useCanvasStore.getState().removeNode(id)}
            title="削除"
          >
            <X size={12} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="px-3 pt-3 flex gap-1">
          <button
            className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-[11px] font-medium nodrag transition-colors"
            style={
              mode === 'image' || mode === 'unset'
                ? { background: 'rgba(139,92,246,0.2)', color: '#8B5CF6' }
                : { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }
            }
            onClick={() => switchMode('image')}
            title="画像モード"
          >
            <ImageIcon size={11} />
            画像
          </button>
          <button
            className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-[11px] font-medium nodrag transition-colors"
            style={
              mode === 'text'
                ? { background: 'rgba(99,102,241,0.2)', color: '#6366F1' }
                : { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }
            }
            onClick={() => switchMode('text')}
            title="テキストモード"
          >
            <Type size={11} />
            テキスト
          </button>
        </div>

        {/* Body: slots */}
        <div className="px-3 py-3 flex flex-col gap-2">
          {Array.from({ length: slotCount }).map((_, i) => {
            const content = slotContents[i]
            const accentColor = mode === 'text' ? '#6366F1' : '#8B5CF6'
            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg px-2"
                style={{
                  height: SLOT_HEIGHT,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-canvas)',
                }}
              >
                <span
                  className="text-[10px] font-semibold w-4 text-center flex-shrink-0 tabular-nums"
                  style={{ color: accentColor }}
                >
                  {i + 1}
                </span>

                {content?.type === 'image' ? (
                  <img
                    src={content.url}
                    alt={`Item ${i + 1}`}
                    className="h-8 w-8 object-cover rounded flex-shrink-0"
                  />
                ) : (
                  <div
                    className="h-8 w-8 rounded flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--bg-elevated)' }}
                  >
                    {mode === 'text'
                      ? <Type size={12} style={{ color: 'var(--text-tertiary)' }} />
                      : <ImageIcon size={12} style={{ color: 'var(--text-tertiary)' }} />
                    }
                  </div>
                )}

                <span
                  className="text-[11px] flex-1 truncate"
                  style={{ color: content ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                >
                  {content?.type === 'image'
                    ? '接続済み'
                    : content?.type === 'text'
                      ? (content.text || '接続済み（未入力）')
                      : '未接続 ←'}
                </span>
              </div>
            )
          })}

          {/* Slot count controls */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {slotCount} アイテム
            </span>
            <div className="flex items-center gap-1">
              <button
                className="w-6 h-6 rounded flex items-center justify-center nodrag transition-colors"
                style={{
                  color: slotCount <= 1 ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                  background: 'var(--bg-elevated)',
                  opacity: slotCount <= 1 ? 0.4 : 1,
                  cursor: slotCount <= 1 ? 'default' : 'pointer',
                }}
                onClick={removeSlot}
                title="スロットを削除"
              >
                <Minus size={10} />
              </button>
              <button
                className="w-6 h-6 rounded flex items-center justify-center nodrag transition-colors"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
                onClick={addSlot}
                title="スロットを追加"
              >
                <Plus size={10} />
              </button>
            </div>
          </div>
        </div>

        {/* Output handle */}
        <Handle
          id="out-list"
          type="source"
          position={Position.Right}
          style={{ ...IMAGE_HANDLE_STYLE, top: '50%' }}
        />
      </div>
    </div>
  )
}

export const ListNode = memo(function ListNodeWrapper(props: NodeProps) {
  return <ListNodeInner {...props} />
})
