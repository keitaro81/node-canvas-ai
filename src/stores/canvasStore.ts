import { create } from 'zustand'
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
} from '@xyflow/react'
import type { NodeData, PortType } from '../types/nodes'

export type AppNode = Node<NodeData>

export type AppMode = 'graph' | 'capsule'

interface CanvasState {
  nodes: AppNode[]
  edges: Edge[]
  selectedNodeId: string | null
  projectName: string
  zoom: number
  appMode: AppMode
  capsuleGroupId: string | null   // Capsuleビューで表示するグループノードのid

  onNodesChange: OnNodesChange<AppNode>
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect

  addNode: (node: AppNode) => void
  removeNode: (id: string) => void
  updateNode: (id: string, data: Partial<NodeData>) => void
  setSelectedNode: (id: string | null) => void
  setProjectName: (name: string) => void
  setZoom: (zoom: number) => void
  setNodes: (nodes: AppNode[]) => void
  setEdges: (edges: Edge[]) => void
  resetCanvas: () => void
  setAppMode: (mode: AppMode) => void
  setCapsuleGroupId: (id: string | null) => void
  ungroupNodes: (groupId: string) => void
  /** ノードをグループに追加し、必要に応じてグループを拡張する */
  addNodeToGroup: (nodeId: string, groupId: string) => void
}

const COMPATIBLE: Record<PortType, PortType[]> = {
  text:  ['text'],
  image: ['image'],
  video: ['video', 'image'],
  style: ['style', 'text'],
}

function isCompatible(sourceType: PortType, targetType: PortType): boolean {
  return COMPATIBLE[sourceType]?.includes(targetType) ?? false
}

function getPortType(nodes: AppNode[], nodeId: string, handleId: string | null): PortType {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || !handleId) return 'text'
  // handleId format: "out-image", "in-text", etc.
  const parts = handleId.split('-')
  return (parts[1] as PortType) ?? 'text'
}

const initialNodes: AppNode[] = [
  {
    id: 'welcome',
    type: 'baseNode',
    position: { x: 300, y: 200 },
    data: {
      type: 'text',
      label: 'Text Prompt',
      params: { prompt: 'Hello, Node Canvas AI!' },
      status: 'idle',
    },
  },
]

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: initialNodes,
  edges: [],
  selectedNodeId: null,
  projectName: 'Untitled Project',
  zoom: 1,
  appMode: 'graph',
  capsuleGroupId: null,

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) => {
    // in-image 接続が切断された時、imageSource === 'connection' のノードをクリア
    const removals = changes.filter((c) => c.type === 'remove')
    if (removals.length > 0) {
      const { edges, nodes } = get()
      const nodesToClear: string[] = []
      removals.forEach((change) => {
        const edge = edges.find((e) => e.id === change.id)
        if (!edge || edge.targetHandle !== 'in-image') return
        const targetNode = nodes.find((n) => n.id === edge.target)
        if ((targetNode?.data as Record<string, unknown>)?.imageSource === 'connection') {
          nodesToClear.push(edge.target)
        }
      })
      if (nodesToClear.length > 0) {
        set((state) => ({
          edges: applyEdgeChanges(changes, state.edges),
          nodes: state.nodes.map((n) =>
            nodesToClear.includes(n.id)
              ? { ...n, data: { ...n.data, imageUrl: undefined, imageSource: undefined } }
              : n
          ),
        }))
        return
      }
    }
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) }))
  },

  onConnect: (connection: Connection) => {
    const { nodes } = get()
    const sourceType = getPortType(nodes, connection.source, connection.sourceHandle ?? null)
    const targetType = getPortType(nodes, connection.target, connection.targetHandle ?? null)
    if (!isCompatible(sourceType, targetType)) return

    const edgeColor: Record<PortType, string> = {
      text:  '#6366F1',
      image: '#8B5CF6',
      video: '#EC4899',
      style: '#6B7280',
    }

    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          style: { stroke: edgeColor[sourceType], strokeWidth: 2 },
          animated: false,
          className: '',
        },
        state.edges
      ),
    }))
  },

  addNode: (node) =>
    set((state) => ({ nodes: [...state.nodes, node] })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    })),

  updateNode: (id, data) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    })),

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setProjectName: (name) => set({ projectName: name }),
  setZoom: (zoom) => set({ zoom }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  resetCanvas: () => set({ nodes: [], edges: [], selectedNodeId: null }),
  setAppMode: (mode) => set({ appMode: mode }),
  setCapsuleGroupId: (id) => {
    set((state) => ({
      capsuleGroupId: id,
      nodes: state.nodes.map((n) => {
        if (n.type !== 'groupNode') return n
        const data = n.data as Record<string, unknown>
        return { ...n, data: { ...data, capsuleEnabled: n.id === id } as unknown as NodeData }
      }),
    }))
  },

  ungroupNodes: (groupId) => {
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group) return state

      // グループの絶対位置
      const gx = group.position.x
      const gy = group.position.y

      const updatedNodes = state.nodes
        .filter((n) => n.id !== groupId)
        .map((n) => {
          if (n.parentId !== groupId) return n
          // 子ノードの位置をキャンバス絶対座標に変換
          const { parentId: _p, extent: _e, ...rest } = n as AppNode & { parentId?: string; extent?: unknown }
          return {
            ...rest,
            position: { x: gx + n.position.x, y: gy + n.position.y },
          } as AppNode
        })

      // capsuleGroupId がこのグループを指していたらリセット
      const newCapsuleGroupId = state.capsuleGroupId === groupId ? null : state.capsuleGroupId

      return { nodes: updatedNodes, capsuleGroupId: newCapsuleGroupId }
    })
  },

  addNodeToGroup: (nodeId, groupId) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId)
      const group = state.nodes.find((n) => n.id === groupId)
      if (!node || !group) return state

      const padding = 40
      const headerHeight = 28

      const groupWidth = (group.style?.width as number | undefined) ?? (group.measured?.width ?? 400)
      const groupHeight = (group.style?.height as number | undefined) ?? (group.measured?.height ?? 300)

      // ノードの絶対座標をグループ相対座標に変換
      const relX = node.position.x - group.position.x
      const relY = node.position.y - group.position.y

      const nodeWidth = (node.measured?.width ?? (node.width as number | undefined) ?? 280)
      const nodeHeight = (node.measured?.height ?? (node.height as number | undefined) ?? 160)

      // パディング範囲内にクランプ
      const clampedX = Math.max(padding, relX)
      const clampedY = Math.max(headerHeight + padding, relY)

      // グループの必要サイズを計算
      const requiredWidth = Math.max(groupWidth, clampedX + nodeWidth + padding)
      const requiredHeight = Math.max(groupHeight, clampedY + nodeHeight + padding)

      return {
        nodes: state.nodes.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              parentId: groupId,
              extent: 'parent' as const,
              position: { x: clampedX, y: clampedY },
            }
          }
          if (n.id === groupId && (requiredWidth > groupWidth || requiredHeight > groupHeight)) {
            return {
              ...n,
              style: { ...n.style, width: requiredWidth, height: requiredHeight },
            }
          }
          return n
        }),
      }
    })
  },
}))
