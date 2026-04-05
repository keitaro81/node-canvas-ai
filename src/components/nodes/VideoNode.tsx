import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Video, ChevronDown } from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'

const DURATIONS = ['3秒', '5秒', '10秒']

export const VideoNode = memo(function VideoNode(props: NodeProps) {
  const data = props.data as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const duration = (data.params?.duration as string) ?? DURATIONS[0]

  return (
    <BaseNode
      {...props}
      data={data}
      icon={<Video size={14} />}
      inputs={[
        { id: 'image', portType: 'image' },
        { id: 'prompt', portType: 'text' },
      ]}
      outputs={[{ id: 'out', portType: 'video' }]}
    >
      <label className="text-[11px] text-[var(--text-secondary)] font-medium">動画の長さ</label>
      <div className="relative">
        <select
          className="w-full h-8 rounded-md pl-2.5 pr-8 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
          value={duration}
          onChange={(e) => updateNode(props.id, { params: { ...data.params, duration: e.target.value } })}
        >
          {DURATIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
      </div>

      <div
        className="w-full rounded-md mt-1 flex items-center justify-center text-[11px] text-[var(--text-tertiary)]"
        style={{ height: 80, background: 'var(--bg-canvas)', border: '1px dashed var(--border)' }}
      >
        動画出力なし
      </div>
    </BaseNode>
  )
})
