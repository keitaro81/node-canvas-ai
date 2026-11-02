import { Fragment, memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { PortLabel } from './PortLabel'
import { dimIfNotTarget, useDragTarget } from './portDrag'

/** ポート名の既定（label が無いノード用） */
const PORT_TYPE_LABEL: Record<PortType, string> = { text: 'テキスト', image: '画像', video: '動画', style: 'スタイル', list: 'リスト', cutout: '切り抜き', item: 'アイテム情報', element: '参照一式', cuts: 'カット一式' }
import { X } from 'lucide-react'
import type { NodeData, PortType } from '../../types/nodes'
import { NODE_ACCENT_COLORS } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'

interface BaseNodeProps extends NodeProps {
  data: NodeData
  icon: ReactNode
  children?: ReactNode
  inputs?: Array<{ id: string; portType: PortType; label?: string }>
  outputs?: Array<{ id: string; portType: PortType; label?: string }>
  hideStatus?: boolean
}

function BaseNodeInner({
  id,
  data,
  selected,
  icon,
  children,
  inputs = [],
  outputs = [],
  hideStatus = false,
  type,
}: BaseNodeProps) {
  const drag = useDragTarget(id, type)   // 線のドラッグ中: 候補のポートに名前を出し、合わないポートは薄く（メモ 31）
  const removeNode = useCanvasStore((s) => s.removeNode)
  const accentColor = NODE_ACCENT_COLORS[data.type]

  return (
    <div
      className={[
        'node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible',
        'border transition-all duration-150',
        selected
          ? 'border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
          : 'border-[var(--border)]',
        data.status === 'generating' ? 'node-generating' : '',
      ].join(' ')}
      style={{ background: 'var(--bg-surface)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]"
        style={{ minHeight: 36 }}
      >
        <span style={{ color: accentColor }} className="flex-shrink-0">
          {icon}
        </span>
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">
          {data.label}
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 hover:opacity-100 w-[22px] h-[22px] flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all duration-150"
          onClick={() => removeNode(id)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-3 flex flex-col gap-2">{children}</div>

      {/* Status indicator */}
      {!hideStatus && data.status !== 'idle' && (
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

      {/* Input / Output handles。ノードにマウスを載せるとポート名が横に出る（2026-11-01 メモ 7/16: どの入力につなげるか分かるように） */}
      {inputs.map((port, i) => {
        const top = `${((i + 1) / (inputs.length + 1)) * 100}%`
        const hid = `in-${port.portType}-${port.id}`
        return (
          <Fragment key={port.id}>
            <Handle id={hid} type="target" position={Position.Left} className={`handle-${port.portType}`} style={{ top, width: 20, height: 20, ...dimIfNotTarget(drag, drag.inputOk(hid)) }} />
            <PortLabel top={top} at="input" text={port.label ?? PORT_TYPE_LABEL[port.portType]} show={drag.inputOk(hid)} />
          </Fragment>
        )
      })}
      {outputs.map((port, i) => {
        const top = `${((i + 1) / (outputs.length + 1)) * 100}%`
        const hid = `out-${port.portType}-${port.id}`
        return (
          <Fragment key={port.id}>
            <Handle id={hid} type="source" position={Position.Right} className={`handle-${port.portType}`} style={{ top, width: 20, height: 20, ...dimIfNotTarget(drag, drag.outputOk(hid)) }} />
            <PortLabel top={top} at="output" text={port.label ?? PORT_TYPE_LABEL[port.portType]} show={drag.outputOk(hid)} />
          </Fragment>
        )
      })}
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
