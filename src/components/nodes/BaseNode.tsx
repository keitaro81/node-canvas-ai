import { memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { X } from 'lucide-react'
import type { NodeData, PortType } from '../../types/nodes'
import { NODE_ACCENT_COLORS, PORT_COLORS } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'

interface BaseNodeProps extends NodeProps {
  data: NodeData
  icon: ReactNode
  children?: ReactNode
  inputs?: Array<{ id: string; portType: PortType; label?: string }>
  outputs?: Array<{ id: string; portType: PortType; label?: string }>
}

function BaseNodeInner({
  id,
  data,
  selected,
  icon,
  children,
  inputs = [],
  outputs = [],
}: BaseNodeProps) {
  const removeNode = useCanvasStore((s) => s.removeNode)
  const accentColor = NODE_ACCENT_COLORS[data.type]

  return (
    <div
      className={[
        'node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible',
        'border transition-all duration-150',
        selected
          ? 'border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
          : 'border-[#27272A]',
        data.status === 'generating' ? 'node-generating' : '',
      ].join(' ')}
      style={{ background: '#111113' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 h-9 border-b border-[#27272A]"
        style={{ minHeight: 36 }}
      >
        <span style={{ color: accentColor }} className="flex-shrink-0">
          {icon}
        </span>
        <span className="flex-1 text-[13px] font-semibold text-[#FAFAFA] truncate">
          {data.label}
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 hover:opacity-100 w-[22px] h-[22px] flex items-center justify-center rounded text-[#71717A] hover:text-[#FAFAFA] hover:bg-[#1E1E22] transition-all duration-150"
          onClick={() => removeNode(id)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-3 flex flex-col gap-2">{children}</div>

      {/* Status indicator */}
      {data.status !== 'idle' && (
        <div
          className="mx-3 mb-3 px-2 py-1 rounded text-[11px] font-medium text-center"
          style={{
            background:
              data.status === 'done'
                ? 'rgba(34,197,94,0.15)'
                : data.status === 'error'
                ? 'rgba(239,68,68,0.15)'
                : 'rgba(139,92,246,0.15)',
            color:
              data.status === 'done'
                ? '#22C55E'
                : data.status === 'error'
                ? '#EF4444'
                : '#8B5CF6',
          }}
        >
          {data.status === 'generating' ? '生成中...' : data.status === 'done' ? '完了' : 'エラー'}
        </div>
      )}

      {/* Input handles */}
      {inputs.map((port, i) => (
        <Handle
          key={port.id}
          id={`in-${port.portType}-${port.id}`}
          type="target"
          position={Position.Left}
          style={{
            top: `${((i + 1) / (inputs.length + 1)) * 100}%`,
            width: 20,
            height: 20,
            background: `radial-gradient(circle, ${PORT_COLORS[port.portType]} 3px, #111113 3px 5px, transparent 5px)`,
            border: 'none',
            borderRadius: 0,
          }}
        />
      ))}

      {/* Output handles */}
      {outputs.map((port, i) => (
        <Handle
          key={port.id}
          id={`out-${port.portType}-${port.id}`}
          type="source"
          position={Position.Right}
          style={{
            top: `${((i + 1) / (outputs.length + 1)) * 100}%`,
            width: 20,
            height: 20,
            background: `radial-gradient(circle, ${PORT_COLORS[port.portType]} 3px, #111113 3px 5px, transparent 5px)`,
            border: 'none',
            borderRadius: 0,
          }}
        />
      ))}
    </div>
  )
}

// Wrap with group hover support
export const BaseNode = memo(function BaseNodeWrapper(props: BaseNodeProps) {
  return (
    <div className="group">
      <BaseNodeInner {...props} />
    </div>
  )
})
