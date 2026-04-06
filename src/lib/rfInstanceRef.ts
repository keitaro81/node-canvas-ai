import type { ReactFlowInstance, Edge } from '@xyflow/react'
import type { AppNode } from '../stores/canvasStore'

/** Canvas の ReactFlow インスタンスをモジュール間で共有する */
export const rfInstanceRef: { current: ReactFlowInstance<AppNode, Edge> | null } = { current: null }
