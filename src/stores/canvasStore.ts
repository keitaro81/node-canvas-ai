import { create } from 'zustand'
import { temporal } from 'zundo'
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

// ===== Undo/Redo (zundo) =====

/** 生成系フィールド: 変更時にundoスナップショットを作らない */
const GEN_FIELDS = new Set([
  'status', 'progress', 'videoUrl', 'output', 'error',
  'requestId', 'requestEndpoint', 'fileName',
  'outputText', 'uploadedImagePreview',
])

export type PartialCanvasState = Pick<CanvasState, 'nodes' | 'edges'>

/** 生成系フィールドのみ抽出（undo後に再適用するため） */
function extractGenData(node: AppNode): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node.data as Record<string, unknown>).filter(([k]) => GEN_FIELDS.has(k))
  )
}

/**
 * true = 等値（スナップショット不要）
 * - ドラッグ中はスナップショットを作らない（ドラッグ終了時のみ記録）
 * - 生成系フィールドのみの変化はスナップショット不要
 */
function areStatesEqual(past: PartialCanvasState, curr: PartialCanvasState): boolean {
  if (curr.nodes.some(n => n.dragging)) return true

  if (past.nodes.length !== curr.nodes.length) return false

  // エッジ: 構造的比較（React Flow の selected フラグ変化を無視）
  if (past.edges.length !== curr.edges.length) return false
  for (let i = 0; i < past.edges.length; i++) {
    const pe = past.edges[i], ce = curr.edges[i]
    if (pe === ce) continue
    if (pe.id !== ce.id || pe.source !== ce.source || pe.target !== ce.target) return false
    if (pe.sourceHandle !== ce.sourceHandle || pe.targetHandle !== ce.targetHandle) return false
  }

  // ノード: 構造 + 生成系フィールドを除いたデータを比較
  for (let i = 0; i < past.nodes.length; i++) {
    const p = past.nodes[i], c = curr.nodes[i]
    if (p === c) continue
    if (p.id !== c.id || p.type !== c.type) return false
    if (p.position.x !== c.position.x || p.position.y !== c.position.y) return false
    if (p.style !== c.style || p.parentId !== c.parentId || p.extent !== c.extent) return false
    if (p.data === c.data) continue
    const pd = p.data as Record<string, unknown>
    const cd = c.data as Record<string, unknown>
    const allKeys = new Set([...Object.keys(pd), ...Object.keys(cd)])
    for (const key of allKeys) {
      if (GEN_FIELDS.has(key)) continue
      if (pd[key] !== cd[key]) return false
    }
  }
  return true
}

export type ToolMode = 'select' | 'hand'

interface CanvasState {
  nodes: AppNode[]
  edges: Edge[]
  selectedNodeId: string | null
  projectName: string
  zoom: number
  appMode: AppMode
  capsuleGroupId: string | null   // Capsuleビューで表示するグループノードのid
  toolMode: ToolMode

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
  setToolMode: (mode: ToolMode) => void
  ungroupNodes: (groupId: string) => void
  /** ノードをグループに追加し、必要に応じてグループを拡張する */
  addNodeToGroup: (nodeId: string, groupId: string) => void
  /** ノード+エッジを原子的に追加する（コピーペースト用：1スナップショット） */
  pasteNodes: (nodes: AppNode[], edges: Edge[]) => void
}

const COMPATIBLE: Record<PortType, PortType[]> = {
  text:  ['text'],
  image: ['image'],
  video: ['video', 'image'],
  style: ['style', 'text'],
  list:  ['list'],
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

export const useCanvasStore = create<CanvasState>()(temporal((set, get) => {
  /**
   * ドラッグ開始前の状態（ドラッグ終了時に手動でスナップショットを作るため）
   *
   * 問題: zundo は set() 呼び出し直前の state を pastState として毎回キャプチャする。
   * ドラッグ終了時の pastState = 最後の dragging:true 更新後の state（位置は finalPos と同じ）。
   * areStatesEqual が "位置変化なし" と判断してスナップショットが作られない。
   * 解決策: ドラッグ開始時に状態を保存し、ドラッグ終了後に手動で pastStates へ push する。
   */
  let preDragSnapshot: PartialCanvasState | null = null

  /**
   * エッジ削除前の状態（ノード削除と組み合わせたスナップショット作成のため）
   *
   * 問題: React Flow はノード削除時に onEdgesChange → onNodesChange の順で呼ぶ。
   * onEdgesChange でスナップショット {nodes:全, edges:削除済み} が作られ、
   * onNodesChange でさらに {nodes:削除済み, edges:削除済み} が作られる → 2回のundoが必要。
   * 解決策: onEdgesChange では pause() でスナップショットを抑制し状態を保存。
   * onNodesChange でまとめて1つのスナップショットを push する。
   */
  let preDeletionState: PartialCanvasState | null = null

  return {
  nodes: initialNodes,
  edges: [],
  selectedNodeId: null,
  projectName: 'Untitled Project',
  zoom: 1,
  appMode: 'graph',
  capsuleGroupId: null,
  toolMode: 'select',

  setToolMode: (mode) => set({ toolMode: mode }),

  onNodesChange: (changes) => {
    const removedIds = changes
      .filter((c) => c.type === 'remove')
      .map((c) => (c as { id: string }).id)

    // ドラッグ開始を検出 → preDragSnapshot を保存
    const isDragStart = changes.some(
      (c) => c.type === 'position' && (c as { dragging?: boolean }).dragging === true
    )
    if (isDragStart && !preDragSnapshot) {
      const s = get()
      preDragSnapshot = { nodes: s.nodes, edges: s.edges }
    }

    // ノード削除 + 先行する onEdgesChange がある場合 → まとめて1スナップショット
    if (removedIds.length > 0 && preDeletionState) {
      const snapshot = preDeletionState
      preDeletionState = null
      const tp = useCanvasStore.temporal.getState()
      tp.pause()
      set((state) => ({
        nodes: applyNodeChanges(changes, state.nodes),
        edges: state.edges.filter((e) => !removedIds.includes(e.source) && !removedIds.includes(e.target)),
      }))
      tp.resume()
      pushSnapshot(snapshot)
      return
    }

    // ドラッグ終了 → preDragSnapshot を1スナップショットとして push
    const isDragEnd = changes.some(
      (c) => c.type === 'position' && (c as { dragging?: boolean }).dragging === false
    )
    if (isDragEnd && preDragSnapshot) {
      const snapshot = preDragSnapshot
      preDragSnapshot = null
      const tp = useCanvasStore.temporal.getState()
      tp.pause()
      set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) }))
      tp.resume()
      pushSnapshot(snapshot)
      return
    }

    // 通常の変更（ノード削除単体 / 選択変化 / その他）
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      ...(removedIds.length > 0
        ? { edges: state.edges.filter((e) => !removedIds.includes(e.source) && !removedIds.includes(e.target)) }
        : {}),
    }))
  },

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

      // エッジ削除前の状態を保存（ノード削除と組み合わせるため）
      const s = get()
      preDeletionState = { nodes: s.nodes, edges: s.edges }

      // pause してスナップショット抑制（onNodesChange か microtask でまとめて push）
      const tp = useCanvasStore.temporal.getState()
      tp.pause()
      if (nodesToClear.length > 0) {
        set((state) => ({
          edges: applyEdgeChanges(changes, state.edges),
          nodes: state.nodes.map((n) =>
            nodesToClear.includes(n.id)
              ? { ...n, data: { ...n.data, imageUrl: undefined, imageSource: undefined } }
              : n
          ),
        }))
      } else {
        set((state) => ({ edges: applyEdgeChanges(changes, state.edges) }))
      }
      tp.resume()

      // マイクロタスク: onNodesChange が来なかった = ユーザーによる単体エッジ削除
      queueMicrotask(() => {
        if (preDeletionState) {
          const snapshot = preDeletionState
          preDeletionState = null
          // エッジ数が変わっていれば削除が成立 → スナップショットを push
          if (snapshot.edges.length !== useCanvasStore.getState().edges.length) {
            pushSnapshot(snapshot)
          }
        }
      })
      return
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
      list:  '#8B5CF6',
    }

    set((state) => {
      // 同じ入力ハンドルへの既存接続を先に除去（1ハンドル1接続を保証）
      const filteredEdges = connection.targetHandle
        ? state.edges.filter(
            (e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle)
          )
        : state.edges

      // 全く同じ接続がすでに存在する場合はスキップ（重複エッジ防止）
      const alreadyExists = filteredEdges.some(
        (e) =>
          e.source === connection.source &&
          e.sourceHandle === connection.sourceHandle &&
          e.target === connection.target &&
          e.targetHandle === connection.targetHandle
      )
      if (alreadyExists) return state

      const newEdges = addEdge(
        {
          ...connection,
          style: { stroke: edgeColor[sourceType], strokeWidth: 2 },
          animated: false,
          className: '',
        },
        filteredEdges
      )

      // ListNode スロットへの最初の接続時にモードを自動確定
      const targetNode = state.nodes.find((n) => n.id === connection.target)
      const isListSlot =
        targetNode?.type === 'listNode' &&
        (connection.targetHandle?.startsWith('in-image-') || connection.targetHandle?.startsWith('in-text-'))
      const listData = isListSlot ? (targetNode!.data as unknown as { mode: string; slotCount: number }) : null
      const shouldAutoSetMode = listData?.mode === 'unset'

      let nodes = state.nodes
      if (shouldAutoSetMode) {
        const newMode = connection.targetHandle!.startsWith('in-image-') ? 'image' : 'text'
        nodes = state.nodes.map((n) =>
          n.id === connection.target
            ? { ...n, data: { ...n.data, mode: newMode } }
            : n
        )
      }

      return { edges: newEdges, nodes }
    })
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

      // ImageGenerationNode / VideoGenerationNode の場合: 接続済み DisplayNode も一緒にグループに追加する
      const connectedDisplayIds =
        node.type === 'imageGenerationNode'
          ? state.edges
              .filter(
                (e) =>
                  e.source === nodeId &&
                  e.sourceHandle === 'out-image-image-out' &&
                  state.nodes.find((n) => n.id === e.target)?.type === 'imageDisplayNode' &&
                  !state.nodes.find((n) => n.id === e.target)?.parentId
              )
              .map((e) => e.target)
          : node.type === 'videoGenerationNode'
          ? state.edges
              .filter(
                (e) =>
                  e.source === nodeId &&
                  e.sourceHandle === 'out-video' &&
                  state.nodes.find((n) => n.id === e.target)?.type === 'videoDisplayNode' &&
                  !state.nodes.find((n) => n.id === e.target)?.parentId
              )
              .map((e) => e.target)
          : []

      // グループの必要サイズを計算（DisplayNode 分も考慮）
      let requiredWidth = Math.max(groupWidth, clampedX + nodeWidth + padding)
      let requiredHeight = Math.max(groupHeight, clampedY + nodeHeight + padding)

      // DisplayNode の相対座標を計算して必要サイズに反映
      const displayPlacements: Record<string, { x: number; y: number }> = {}
      for (const did of connectedDisplayIds) {
        const dn = state.nodes.find((n) => n.id === did)
        if (!dn) continue
        const dRelX = Math.max(padding, dn.position.x - group.position.x)
        const dRelY = Math.max(headerHeight + padding, dn.position.y - group.position.y)
        const dW = (dn.measured?.width ?? (dn.width as number | undefined) ?? 280)
        const dH = (dn.measured?.height ?? (dn.height as number | undefined) ?? 360)
        displayPlacements[did] = { x: dRelX, y: dRelY }
        requiredWidth = Math.max(requiredWidth, dRelX + dW + padding)
        requiredHeight = Math.max(requiredHeight, dRelY + dH + padding)
      }

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
          if (connectedDisplayIds.includes(n.id) && displayPlacements[n.id]) {
            return {
              ...n,
              parentId: groupId,
              extent: 'parent' as const,
              position: displayPlacements[n.id],
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

  pasteNodes: (newNodes, newEdges) => {
    set((state) => ({
      nodes: [
        ...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...newNodes,
      ],
      edges: [
        ...state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        ...newEdges,
      ],
    }))
  },
  } // return
}, {
  partialize: (state): PartialCanvasState => ({ nodes: state.nodes, edges: state.edges }),
  equality: areStatesEqual,
  limit: 50,
}))

/** pastStates に手動でスナップショットを追加する（limit=50 を考慮）*/
export function pushSnapshot(snapshot: PartialCanvasState): void {
  const tp = useCanvasStore.temporal.getState()
  const prev = tp.pastStates
  const pastStates = prev.length >= 50 ? [...prev.slice(1), snapshot] : [...prev, snapshot]
  useCanvasStore.temporal.setState({ pastStates, futureStates: [] })
}


/**
 * ワークフロー読み込み時に呼ぶ。nodes/edges/capsuleGroupId を原子的にセットし、
 * 読み込みで生じたundoスナップショット（エッジ空状態等）をすべてクリアする。
 */
export function loadCanvasState(
  nodes: AppNode[],
  edges: Edge[],
  capsuleGroupId: string | null
): void {
  // 重複IDのエッジを除去（古いデータで同一接続が複数保存されている場合の対策）
  const seenIds = new Set<string>()
  const dedupedEdges = edges.filter((e) => {
    if (seenIds.has(e.id)) return false
    seenIds.add(e.id)
    return true
  })
  useCanvasStore.setState({ nodes, edges: dedupedEdges, capsuleGroupId, appMode: 'graph' })
  useCanvasStore.temporal.getState().clear()
}

/** Cmd+Z: 構造的変更をundo。生成結果（videoUrl等）は現在の値を保持する */
export function undoCanvas(): void {
  const tp = useCanvasStore.temporal.getState()
  if (tp.pastStates.length === 0) return
  const genMap = new Map(useCanvasStore.getState().nodes.map(n => [n.id, extractGenData(n)]))
  tp.undo()
  tp.pause()
  useCanvasStore.setState({
    nodes: useCanvasStore.getState().nodes.map(n => ({
      ...n, data: { ...n.data, ...(genMap.get(n.id) ?? {}) } as unknown as NodeData,
    }))
  })
  tp.resume()
}

/** Cmd+Shift+Z: 構造的変更をredo。生成結果（videoUrl等）は現在の値を保持する */
export function redoCanvas(): void {
  const tp = useCanvasStore.temporal.getState()
  if (tp.futureStates.length === 0) return
  const genMap = new Map(useCanvasStore.getState().nodes.map(n => [n.id, extractGenData(n)]))
  tp.redo()
  tp.pause()
  useCanvasStore.setState({
    nodes: useCanvasStore.getState().nodes.map(n => ({
      ...n, data: { ...n.data, ...(genMap.get(n.id) ?? {}) } as unknown as NodeData,
    }))
  })
  tp.resume()
}
