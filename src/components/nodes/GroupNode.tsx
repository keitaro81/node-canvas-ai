import { memo, useMemo, useState } from 'react'
import { type NodeProps, NodeResizer } from '@xyflow/react'
import { Layers, Pencil, Check } from 'lucide-react'
import type { GroupNodeData } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'
import { useLiveCanvas } from '../../hooks/useLiveCanvas'
import { appIssueOf } from '../../lib/apps/appKind'

function GroupNodeInner({ id, data, selected }: NodeProps) {
  const groupData = data as unknown as GroupNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const capsuleGroupId = useCanvasStore((s) => s.capsuleGroupId)

  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(groupData.label)

  const isCapsuleTarget = capsuleGroupId === id
  // App 化したグループが一括 App として動かせない理由（入口が 2 つ以上・画像と動画の混在・動画が 2 本以上）をグループの上に出す（2026-11-02 段階 3）
  const live = useLiveCanvas()
  const issue = useMemo(() => (isCapsuleTarget ? appIssueOf({ capsuleGroupId, nodes: live.nodes, edges: live.edges }, id) : null), [isCapsuleTarget, live, capsuleGroupId, id])

  function commitLabel() {
    const trimmed = labelDraft.trim() || 'Group'
    updateNode(id, { label: trimmed } as never)
    setEditingLabel(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitLabel()
    if (e.key === 'Escape') { setLabelDraft(groupData.label); setEditingLabel(false) }
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

      {issue && (
        <div className="absolute left-2.5 right-2.5 px-2 py-1 rounded text-[11px] pointer-events-none" style={{ top: 34, color: '#F59E0B', background: 'rgba(245,158,11,0.12)', zIndex: 1 }}>{issue.message}</div>
      )}

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
      </div>

    </div>
  )
}

export const GroupNode = memo(function GroupNodeWrapper(props: NodeProps) {
  return <GroupNodeInner {...props} />
})
