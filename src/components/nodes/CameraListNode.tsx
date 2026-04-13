import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Camera, Plus, X } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { CAMERA_PRESETS } from '../../lib/cameraPresets'
import type { CameraListNodeData } from '../../types/nodes'

const HANDLE_STYLE = {
  width: 20,
  height: 20,
  background: 'radial-gradient(circle, #8B5CF6 3px, var(--bg-surface) 3px 5px, transparent 5px)',
  border: 'none',
  borderRadius: 0,
} as const

function CameraListNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as CameraListNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)

  const selectedPresets = nodeData.selectedPresets ?? []
  const customAngles = nodeData.customAngles ?? []
  const [customInput, setCustomInput] = useState('')

  const totalCount = selectedPresets.length + customAngles.filter((a) => a.trim()).length

  function togglePreset(presetId: string) {
    const next = selectedPresets.includes(presetId)
      ? selectedPresets.filter((p) => p !== presetId)
      : [...selectedPresets, presetId]
    updateNode(id, { selectedPresets: next } as Partial<CameraListNodeData>)
  }

  function addCustom() {
    const trimmed = customInput.trim()
    if (!trimmed) return
    updateNode(id, { customAngles: [...customAngles, trimmed] } as Partial<CameraListNodeData>)
    setCustomInput('')
  }

  function removeCustom(index: number) {
    updateNode(id, { customAngles: customAngles.filter((_, i) => i !== index) } as Partial<CameraListNodeData>)
  }

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
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]"
        >
          <div className="w-0.5 h-4 rounded-full shrink-0" style={{ background: '#8B5CF6' }} />
          <Camera size={14} className="shrink-0" style={{ color: '#8B5CF6' }} />
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

        {/* Body */}
        <div className="px-3 py-3 flex flex-col gap-2">

          {/* Preset toggles */}
          <div className="flex flex-wrap gap-1">
            {CAMERA_PRESETS.map((preset) => {
              const active = selectedPresets.includes(preset.id)
              return (
                <button
                  key={preset.id}
                  className="px-2 py-1 rounded text-[11px] font-medium nodrag transition-colors"
                  style={{
                    background: active ? 'rgba(139,92,246,0.25)' : 'var(--bg-elevated)',
                    color: active ? '#8B5CF6' : 'var(--text-secondary)',
                    border: `1px solid ${active ? '#8B5CF6' : 'var(--border)'}`,
                  }}
                  onClick={() => togglePreset(preset.id)}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)' }} />

          {/* Custom angles */}
          {customAngles.length > 0 && (
            <div className="flex flex-col gap-1">
              {customAngles.map((angle, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2 py-1 rounded"
                  style={{ background: 'rgba(139,92,246,0.25)', border: '1px solid #8B5CF6' }}
                >
                  <span className="flex-1 text-[11px] truncate" style={{ color: '#8B5CF6' }}>{angle}</span>
                  <button
                    className="shrink-0 nodrag"
                    style={{ color: 'var(--text-tertiary)' }}
                    onClick={() => removeCustom(i)}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Custom input */}
          <div className="flex gap-1">
            <input
              type="text"
              className="flex-1 rounded px-2 py-1 text-[11px] text-[var(--text-primary)] nodrag"
              style={{
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border)',
                outline: 'none',
              }}
              placeholder="カスタムアングルを追加..."
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addCustom() }}
            />
            <button
              className="w-7 h-7 rounded flex items-center justify-center shrink-0 nodrag transition-colors"
              style={{
                background: customInput.trim() ? '#8B5CF6' : 'var(--bg-elevated)',
                color: customInput.trim() ? 'white' : 'var(--text-tertiary)',
              }}
              onClick={addCustom}
              title="追加"
            >
              <Plus size={12} />
            </button>
          </div>

          {/* Count badge */}
          <div className="flex items-center justify-end">
            <span
              className="text-[11px] rounded-full px-1.5 py-0.5 font-medium"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#8B5CF6' }}
            >
              {totalCount} アングル
            </span>
          </div>
        </div>

        {/* Output handle */}
        <Handle
          id="out-list"
          type="source"
          position={Position.Right}
          style={{ ...HANDLE_STYLE, top: '50%' }}
        />
      </div>
    </div>
  )
}

export const CameraListNode = memo(function CameraListNodeWrapper(props: NodeProps) {
  return <CameraListNodeInner {...props} />
})
