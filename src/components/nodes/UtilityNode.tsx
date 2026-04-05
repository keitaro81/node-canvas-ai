import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Wrench } from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '../../types/nodes'

export const UtilityNode = memo(function UtilityNode(props: NodeProps) {
  const data = props.data as NodeData

  return (
    <BaseNode
      {...props}
      data={data}
      icon={<Wrench size={14} />}
      inputs={[{ id: 'in', portType: 'text' }]}
      outputs={[{ id: 'out', portType: 'text' }]}
    >
      <p className="text-[12px] text-[var(--text-secondary)]">ユーティリティノード</p>
    </BaseNode>
  )
})
