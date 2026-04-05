import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Image, ChevronDown } from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'

const MODELS = ['Stable Diffusion XL', 'DALL-E 3', 'Midjourney v6']

export const ImageNode = memo(function ImageNode(props: NodeProps) {
  const data = props.data as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const model = (data.params?.model as string) ?? MODELS[0]

  return (
    <BaseNode
      {...props}
      data={data}
      icon={<Image size={14} />}
      inputs={[{ id: 'prompt', portType: 'text' }]}
      outputs={[{ id: 'out', portType: 'image' }]}
    >
      <label className="text-[11px] text-[var(--text-secondary)] font-medium">モデル</label>
      <div className="relative">
        <select
          className="w-full h-8 rounded-md pl-2.5 pr-8 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
          value={model}
          onChange={(e) => updateNode(props.id, { params: { ...data.params, model: e.target.value } })}
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
      </div>

      {data.output ? (
        <img
          src={data.output as string}
          alt="generated"
          className="w-full rounded-md mt-1 object-cover"
          style={{ maxHeight: 160 }}
        />
      ) : (
        <div
          className="w-full rounded-md mt-1 flex items-center justify-center text-[11px] text-[var(--text-tertiary)]"
          style={{ height: 100, background: 'var(--bg-canvas)', border: '1px dashed var(--border)' }}
        >
          出力なし
        </div>
      )}
    </BaseNode>
  )
})
