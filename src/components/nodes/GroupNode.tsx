import { memo, useState } from 'react'
import { type NodeProps, NodeResizer } from '@xyflow/react'
import { Layers, Pencil, Check, X, AlertTriangle } from 'lucide-react'
import type { GroupNodeData } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'
import { hasParallelGenerationNodes } from '../capsule/capsuleUtils'

function GroupNodeInner({ id, data, selected }: NodeProps) {
  const groupData = data as unknown as GroupNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const setCapsuleGroupId = useCanvasStore((s) => s.setCapsuleGroupId)
  const capsuleGroupId = useCanvasStore((s) => s.capsuleGroupId)

  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(groupData.label)
  const [warning, setWarning] = useState<string | null>(null)

  const isCapsuleTarget = capsuleGroupId === id

  function commitLabel() {
    const trimmed = labelDraft.trim() || 'Group'
    updateNode(id, { label: trimmed } as never)
    setEditingLabel(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitLabel()
    if (e.key === 'Escape') { setLabelDraft(groupData.label); setEditingLabel(false) }
  }

  function toggleCapsule() {
    if (isCapsuleTarget) {
      setCapsuleGroupId(null)
      return
    }

    // App化しようとする場合: 並列生成ノードがないか確認
    const { nodes, edges } = useCanvasStore.getState()
    if (hasParallelGenerationNodes(id, nodes, edges)) {
      setWarning('並列生成はAppモードでサポートされていません。直列接続のワークフローにしてください。')
      setTimeout(() => setWarning(null), 4000)
      return
    }

    setCapsuleGroupId(id)
  }

  return (
    <div
      className="relative w-full h-full"
      style={{
        borderRadius: 12,
        border: `1px dashed ${isCapsuleTarget ? '#8B5CF6' : 'var(--border-active)'}`,
        background: isCapsuleTarget ? 'rgba(139,92,246,0.04)' : 'rgba(255,255,255,0.01)',
      }}
    >
      <NodeResizer
        minWidth={200}
        minHeight={120}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--border-active)' }}
        handleStyle={{ background: 'var(--border-active)', border: 'none', width: 8, height: 8, borderRadius: 2 }}
      />

      {/* Header bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center gap-1.5 px-2.5 nodrag"
        style={{
          height: 36,
          background: 'var(--bg-canvas)',
          borderBottom: `1px dashed ${isCapsuleTarget ? '#8B5CF6' : 'var(--border-active)'}`,
          borderRadius: '11px 11px 0 0',
        }}
      >
        <Layers size={12} style={{ color: isCapsuleTarget ? '#8B5CF6' : 'var(--text-tertiary)', flexShrink: 0 }} />

        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-[12px] font-medium text-[var(--text-primary)] outline-none border-b border-[var(--border-active)] min-w-0"
          />
        ) : (
          <span
            className="flex-1 text-[12px] font-medium truncate min-w-0 cursor-text"
            style={{ color: isCapsuleTarget ? '#C4B5FD' : 'var(--text-secondary)' }}
            onDoubleClick={() => { setLabelDraft(groupData.label); setEditingLabel(true) }}
          >
            {groupData.label}
          </span>
        )}

        {editingLabel ? (
          <button
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]"
            onMouseDown={(e) => { e.preventDefault(); commitLabel() }}
          >
            <Check size={11} style={{ color: '#22C55E' }} />
          </button>
        ) : (
          <button
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]"
            onClick={() => { setLabelDraft(groupData.label); setEditingLabel(true) }}
            title="名前を変更"
          >
            <Pencil size={11} style={{ color: 'var(--text-tertiary)' }} />
          </button>
        )}

        {/* App toggle */}
        <button
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all"
          style={
            isCapsuleTarget
              ? { background: '#4C1D95', color: '#C4B5FD', border: '1px solid #7C3AED' }
              : { background: 'var(--bg-panel)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }
          }
          onClick={toggleCapsule}
          title={isCapsuleTarget ? 'Appビューの対象から外す' : 'Appとして設定'}
        >
          {isCapsuleTarget ? (
            <>
              <X size={9} />
              App
            </>
          ) : (
            <>App</>
          )}
        </button>
      </div>

      {/* Warning tooltip */}
      {warning && (
        <div
          className="absolute left-0 right-0 flex items-start gap-1.5 px-2.5 py-2 nodrag"
          style={{
            top: 32,
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: '0 0 8px 8px',
            zIndex: 10,
          }}
        >
          <AlertTriangle size={11} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 1 }} />
          <span className="text-[10px] leading-snug" style={{ color: '#FCD34D' }}>{warning}</span>
        </div>
      )}
    </div>
  )
}

export const GroupNode = memo(function GroupNodeWrapper(props: NodeProps) {
  return <GroupNodeInner {...props} />
})
