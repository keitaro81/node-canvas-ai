import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Type } from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'

export const TextNode = memo(function TextNode(props: NodeProps) {
  const data = props.data as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const prompt = (data.params?.prompt as string) ?? ''

  return (
    <BaseNode
      {...props}
      data={data}
      icon={<Type size={14} />}
      outputs={[{ id: 'out', portType: 'text' }]}
    >
      <label className="text-[11px] text-[var(--text-secondary)] font-medium">プロンプト</label>
      <textarea
        className="w-full min-h-[80px] resize-y rounded-md px-2.5 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-active)] transition-colors duration-150 nodrag"
        style={{
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border)',
        }}
        placeholder="テキストプロンプトを入力..."
        value={prompt}
        onChange={(e) => updateNode(props.id, { params: { ...data.params, prompt: e.target.value } })}
      />
    </BaseNode>
  )
})
