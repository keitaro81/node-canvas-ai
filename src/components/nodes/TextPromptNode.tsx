import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Type } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { CapsuleFieldToggle } from './CapsuleFieldToggle'
import type { NodeData, CapsuleFieldDef, CapsuleVisibility } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'

export const TextPromptNode = memo(function TextPromptNode(props: NodeProps) {
  const data = props.data as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const prompt = (data.params?.prompt as string) ?? ''

  const capsuleFields = (data.capsuleFields ?? {}) as Record<string, CapsuleFieldDef>

  function getCapsuleVisibility(fieldId: string): CapsuleVisibility {
    return capsuleFields[fieldId]?.capsuleVisibility ?? 'visible'
  }

  function handleCapsuleChange(fieldId: string, visibility: CapsuleVisibility) {
    const updated: Record<string, CapsuleFieldDef> = {
      ...capsuleFields,
      [fieldId]: { id: fieldId, capsuleVisibility: visibility },
    }
    updateNode(props.id, { capsuleFields: updated } as Partial<NodeData>)
  }

  return (
    <BaseNode
      {...props}
      data={data}
      icon={<Type size={14} />}
      outputs={[{ id: 'text-out', portType: 'text' }]}
    >
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-[#A1A1AA] font-medium">プロンプト</label>
        <CapsuleFieldToggle
          fieldId="prompt"
          visibility={getCapsuleVisibility('prompt')}
          onChange={handleCapsuleChange}
        />
      </div>
      <textarea
        className="w-full resize-y rounded-md px-2.5 py-2 text-[12px] text-[#FAFAFA] placeholder-[#71717A] focus:outline-none transition-colors duration-150 nodrag"
        style={{
          background: '#0A0A0B',
          border: '1px solid #27272A',
          minHeight: '72px',
        }}
        rows={3}
        placeholder="プロンプトを入力..."
        value={prompt}
        onChange={(e) =>
          updateNode(props.id, { params: { ...data.params, prompt: e.target.value } })
        }
      />
      <div className="text-[11px] text-[#71717A] text-right tabular-nums">
        {prompt.length} 文字
      </div>
    </BaseNode>
  )
})
