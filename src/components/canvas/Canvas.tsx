import { useCallback, useState, useRef, useEffect } from 'react'
import { MapTrifold } from '@phosphor-icons/react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  PanOnScrollMode,
  SelectionMode,
  type NodeTypes,
  type ReactFlowInstance,
  type Edge,
  type OnConnectStartParams,
  type FinalConnectionState,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import { rfInstanceRef } from '../../lib/rfInstanceRef'
import { useWorkflowStore } from '../../stores/workflowStore'
import { ContextMenu } from './ContextMenu'
import { TextNode } from '../nodes/TextNode'
import { ImageNode } from '../nodes/ImageNode'
import { VideoNode } from '../nodes/VideoNode'
import { UtilityNode } from '../nodes/UtilityNode'
import { TextPromptNode } from '../nodes/TextPromptNode'
import { ImageGenerationNode } from '../nodes/ImageGenerationNode'
import { ImageDisplayNode } from '../nodes/ImageDisplayNode'
import { NoteNode } from '../nodes/NoteNode'
import { VideoGenerationNode } from '../nodes/VideoGenerationNode'
import { VideoDisplayNode } from '../nodes/VideoDisplayNode'
import { ReferenceImageNode } from '../nodes/ReferenceImageNode'
import { PromptEnhancerNode } from '../nodes/PromptEnhancerNode'
import { GroupNode } from '../nodes/GroupNode'
import type { NodeType, NodeData, VideoGenerationNodeData, ReferenceImageNodeData, PortType, GroupNodeData } from '../../types/nodes'
import { fal } from '../../lib/ai/fal-client'
import { hasParallelGenerationNodes } from '../capsule/capsuleUtils'
import { useTheme } from '../../hooks/useTheme'

const nodeTypes: NodeTypes = {
  baseNode: TextNode, // fallback
  textNode: TextNode,
  imageNode: ImageNode,
  videoNode: VideoNode,
  utilityNode: UtilityNode,
  textPromptNode: TextPromptNode,
  imageGenerationNode: ImageGenerationNode,
  imageDisplayNode: ImageDisplayNode,
  videoGenerationNode: VideoGenerationNode,
  videoDisplayNode: VideoDisplayNode,
  referenceImageNode: ReferenceImageNode,
  noteNode: NoteNode,
  promptEnhancerNode: PromptEnhancerNode,
  groupNode: GroupNode,
}

const NODE_TYPE_MAP: Record<NodeType, string> = {
  text:           'textNode',
  image:          'imageNode',
  video:          'videoNode',
  utility:        'utilityNode',
  textPrompt:     'textPromptNode',
  imageGen:       'imageGenerationNode',
  imageDisplay:   'imageDisplayNode',
  videoGen:       'videoGenerationNode',
  videoDisplay:   'videoDisplayNode',
  referenceImage:  'referenceImageNode',
  imageComposite:  'imageCompositeNode', // kept for backward compat with saved workflows
  note:            'noteNode',
  promptEnhancer:  'promptEnhancerNode',
  group:           'groupNode',
}

const VIDEO_GEN_DEFAULT_DATA: VideoGenerationNodeData = {
  label: 'Video Generation',
  model: 'ltx-2.3-fast',
  duration: '6',
  resolution: '1080p',
  aspectRatio: '16:9',
  fps: 25,
  audioEnabled: true,
  seed: null,
  status: 'idle',
  progress: '',
  videoUrl: null,
  fileName: null,
  error: null,
}

const REFERENCE_IMAGE_DEFAULT_DATA: ReferenceImageNodeData = {
  label: 'Reference Image',
  imageUrl: null,
  uploadedImagePreview: null,
}

const IMAGE_GEN_DEFAULT_DATA = {
  type: 'imageGen' as const,
  label: 'Image Generation',
  params: {
    model: 'black-forest-labs/flux-schnell',
    aspectRatio: '1:1',
    seed: '',
  },
  status: 'idle' as const,
}

const PROMPT_ENHANCER_DEFAULT_DATA = {
  type: 'promptEnhancer' as const,
  label: 'アシスタント',
  params: {},
  status: 'idle' as const,
  inputText: '',
  outputText: '',
  model: 'anthropic/claude-haiku-4.5',
}

interface ContextMenuState {
  x: number
  y: number
  flowX: number
  flowY: number
  sourceNodeId?: string
  sourceHandleId?: string | null
  sourcePortType?: PortType
  groupNodeId?: string      // グループノード右クリック時
  targetGroupId?: string    // 新規ノードを追加するグループID
}

let nodeIdCounter = 1

/** フロー座標がグループ内部にあるか判定し、最前面のグループを返す */
function findGroupAtPosition(x: number, y: number, nodes: AppNode[]): AppNode | null {
  const headerHeight = 28
  // 配列末尾（最前面）から探索
  const groups = [...nodes].filter((n) => n.type === 'groupNode').reverse()
  for (const group of groups) {
    const width = (group.style?.width as number | undefined) ?? group.measured?.width ?? 0
    const height = (group.style?.height as number | undefined) ?? group.measured?.height ?? 0
    if (width === 0 || height === 0) continue
    if (
      x >= group.position.x &&
      x <= group.position.x + width &&
      y >= group.position.y + headerHeight &&
      y <= group.position.y + height
    ) {
      return group
    }
  }
  return null
}

/** グループがApp化済みの場合、並列条件になったらApp化を解除する */
function checkAndDisableCapsuleIfNeeded(groupId: string) {
  const { nodes, edges, capsuleGroupId, setCapsuleGroupId } = useCanvasStore.getState()
  if (capsuleGroupId !== groupId) return
  if (hasParallelGenerationNodes(groupId, nodes, edges)) {
    setCapsuleGroupId(null)
  }
}

/** グループへのノード追加時にグループを拡張する（context menu / drop 用） */
function expandGroupIfNeeded(
  groupId: string,
  relX: number,
  relY: number,
  nodeW: number,
  nodeH: number,
  padding: number,
) {
  const { nodes, setNodes } = useCanvasStore.getState()
  const group = nodes.find((n) => n.id === groupId)
  if (!group) return
  const groupWidth = (group.style?.width as number | undefined) ?? 400
  const groupHeight = (group.style?.height as number | undefined) ?? 300
  const requiredWidth = Math.max(groupWidth, relX + nodeW + padding)
  const requiredHeight = Math.max(groupHeight, relY + nodeH + padding)
  if (requiredWidth > groupWidth || requiredHeight > groupHeight) {
    setNodes(
      nodes.map((n) =>
        n.id === groupId
          ? { ...n, style: { ...n.style, width: requiredWidth, height: requiredHeight } }
          : n
      )
    )
  }
}

// ノードタイプ別のデフォルト入力ハンドルID（ポートタイプ → ハンドルID）
const NODE_DEFAULT_INPUT_HANDLE: Partial<Record<NodeType, Record<string, string>>> = {
  promptEnhancer: {},
  imageGen:       { text: 'in-text', image: 'in-image' },
  videoGen:       { text: 'in-text', image: 'in-image' },
  utility:        { text: 'in-text-in' },
}

const PORT_COMPATIBLE: Record<string, string[]> = {
  text:  ['text'],
  image: ['image'],
  video: ['video', 'image'],
  style: ['style', 'text'],
}

function parsePortType(handleId: string | null): string {
  if (!handleId) return 'text'
  return handleId.split('-')[1] ?? 'text'
}

function isCompatiblePorts(sourceType: string, targetType: string): boolean {
  return PORT_COMPATIBLE[sourceType]?.includes(targetType) ?? false
}

// 選択ノードをグループ化するユーティリティ
function groupSelectedNodes(
  nodes: AppNode[],
  setNodes: (ns: AppNode[]) => void
) {
  const selected = nodes.filter((n) => n.selected && n.type !== 'groupNode')
  if (selected.length < 2) return

  const padding = 40
  const headerHeight = 28
  const xs = selected.map((n) => n.position.x)
  const ys = selected.map((n) => n.position.y)
  const x2s = selected.map((n) => n.position.x + (n.measured?.width ?? n.width ?? 280))
  const y2s = selected.map((n) => n.position.y + (n.measured?.height ?? n.height ?? 160))

  const minX = Math.min(...xs) - padding
  const minY = Math.min(...ys) - padding - headerHeight
  const maxX = Math.max(...x2s) + padding
  const maxY = Math.max(...y2s) + padding

  const groupId = `group-${Date.now()}`
  const groupData: GroupNodeData = { label: 'Group', capsuleEnabled: false }

  const groupNode: AppNode = {
    id: groupId,
    type: 'groupNode',
    position: { x: minX, y: minY },
    style: { width: maxX - minX, height: maxY - minY },
    data: groupData as unknown as NodeData,
    selectable: true,
    draggable: true,
  }

  const updatedNodes = nodes.map((n) => {
    if (!selected.find((s) => s.id === n.id)) return n
    return {
      ...n,
      parentId: groupId,
      extent: 'parent' as const,
      position: {
        x: n.position.x - minX,
        y: n.position.y - minY,
      },
      selected: false,
    }
  })

  // グループノードを最背面（先頭）に挿入
  setNodes([groupNode, ...updatedNodes])
}

export function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, updateNode, setSelectedNode, setZoom } =
    useCanvasStore()

  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const canvasBg   = isDark ? 'var(--bg-canvas)' : '#EDECEA'
  const dotColor   = isDark ? '#2A2A30' : '#D0CCC8'
  const surfaceBg  = isDark ? 'var(--bg-surface)' : '#FFFFFF'
  const borderCol  = isDark ? 'var(--border)' : '#E2DED9'

  const isLoadingWorkflow = useWorkflowStore((s) => s.isLoadingWorkflow)
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [showMiniMap, setShowMiniMap] = useState(false)
  const miniMapBtnRef = useRef<HTMLButtonElement>(null)
  const rfInstance = useRef<ReactFlowInstance<AppNode, Edge> | null>(null)
  const connectingNode = useRef<string | null>(null)
  const connectingHandle = useRef<string | null>(null)
  const lastFitWorkflowId = useRef<string | null>(null)
  const altDragActiveRef = useRef(false)
  const dragToBackupIdRef = useRef<Map<string, string>>(new Map())
  const originalEdgesRef = useRef<Edge[]>([])
  const spacePanRef = useRef<{ startX: number; startY: number; vpX: number; vpY: number; zoom: number } | null>(null)

  // Space キー押下管理 + Alt カーソル + ショートカット
  useEffect(() => {
    const altStyle = document.createElement('style')
    altStyle.id = 'alt-copy-cursor'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) setIsSpacePressed(true)
      if (e.key === 'Alt' && !e.repeat) {
        altStyle.textContent = '.react-flow__node { cursor: copy !important; }'
        document.head.appendChild(altStyle)
      }
      if (e.code === 'Digit0' && e.metaKey && e.altKey) {
        e.preventDefault()
        rfInstance.current?.fitView({ padding: 0.15, duration: 400 })
      }
      if (e.code === 'KeyG' && e.metaKey && !e.shiftKey) {
        e.preventDefault()
        const { nodes: currentNodes, setNodes: storeSetNodes } = useCanvasStore.getState()
        groupSelectedNodes(currentNodes, storeSetNodes)
      }
      if (e.code === 'KeyG' && e.metaKey && e.shiftKey) {
        e.preventDefault()
        const { nodes: currentNodes, ungroupNodes } = useCanvasStore.getState()
        const selectedGroup = currentNodes.find((n) => n.selected && n.type === 'groupNode')
        if (selectedGroup) ungroupNodes(selectedGroup.id)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false)
        setIsPanning(false)
        spacePanRef.current = null
      }
      if (e.key === 'Alt') altStyle.remove()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      altStyle.remove()
    }
  }, [])

  const handleSpaceOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const vp = rfInstance.current?.getViewport()
    if (!vp) return
    spacePanRef.current = { startX: e.clientX, startY: e.clientY, vpX: vp.x, vpY: vp.y, zoom: vp.zoom }
    setIsPanning(true)
  }, [])

  const handleSpaceOverlayMouseMove = useCallback((e: React.MouseEvent) => {
    if (!spacePanRef.current || !(e.buttons & 1)) return
    const { startX, startY, vpX, vpY, zoom } = spacePanRef.current
    rfInstance.current?.setViewport({ x: vpX + (e.clientX - startX), y: vpY + (e.clientY - startY), zoom })
  }, [])

  const handleSpaceOverlayMouseUp = useCallback(() => {
    spacePanRef.current = null
    setIsPanning(false)
  }, [])

  // ワークフロー読み込み完了・切り替え後に fitView
  useEffect(() => {
    if (isLoadingWorkflow || !currentWorkflowId) return
    if (lastFitWorkflowId.current === currentWorkflowId) return
    const timer = setTimeout(() => {
      if (rfInstance.current) {
        rfInstance.current.fitView({ padding: 0.15, duration: 400 })
        lastFitWorkflowId.current = currentWorkflowId
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [isLoadingWorkflow, currentWorkflowId])

  useEffect(() => {
    if (!showMiniMap) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('.react-flow__minimap')) return
      if (miniMapBtnRef.current?.contains(target)) return
      setShowMiniMap(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMiniMap])

  const handlePaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault()
    const clientX = 'clientX' in e ? e.clientX : 0
    const clientY = 'clientY' in e ? e.clientY : 0
    const flowPos = rfInstance.current?.screenToFlowPosition({ x: clientX, y: clientY }) ?? { x: clientX, y: clientY }
    const targetGroup = findGroupAtPosition(flowPos.x, flowPos.y, useCanvasStore.getState().nodes)

    setContextMenu({
      x: clientX,
      y: clientY,
      flowX: flowPos.x,
      flowY: flowPos.y,
      targetGroupId: targetGroup?.id,
    })
  }, [])

  const handleNodeSelect = useCallback(
    (type: NodeType, label: string) => {
      if (!contextMenu) return
      const id = `node-${Date.now()}-${nodeIdCounter++}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any
      if (type === 'videoGen') {
        data = { ...VIDEO_GEN_DEFAULT_DATA, label }
      } else if (type === 'referenceImage') {
        data = { ...REFERENCE_IMAGE_DEFAULT_DATA, label }
      } else if (type === 'imageGen') {
        data = { ...IMAGE_GEN_DEFAULT_DATA, label }
      } else if (type === 'promptEnhancer') {
        data = { ...PROMPT_ENHANCER_DEFAULT_DATA, label }
      } else {
        data = { type, label, params: {}, status: 'idle' }
      }

      const targetGroupId = contextMenu.targetGroupId
      const autoConnect = () => {
        if (contextMenu.sourceNodeId && contextMenu.sourcePortType) {
          const targetHandle = NODE_DEFAULT_INPUT_HANDLE[type]?.[contextMenu.sourcePortType] ?? null
          if (targetHandle) {
            onConnect({
              source: contextMenu.sourceNodeId,
              sourceHandle: contextMenu.sourceHandleId ?? null,
              target: id,
              targetHandle,
            })
          }
        }
      }

      if (targetGroupId) {
        const group = useCanvasStore.getState().nodes.find((n) => n.id === targetGroupId)
        if (group) {
          const padding = 40
          const headerHeight = 28
          const nodeDefaultWidth = 280
          const nodeDefaultHeight = type === 'note' ? 160 : 160
          const relX = Math.max(padding, contextMenu.flowX - group.position.x)
          const relY = Math.max(headerHeight + padding, contextMenu.flowY - group.position.y)

          expandGroupIfNeeded(targetGroupId, relX, relY, nodeDefaultWidth, nodeDefaultHeight, padding)

          addNode({
            id,
            type: NODE_TYPE_MAP[type],
            position: { x: relX, y: relY },
            data,
            parentId: targetGroupId,
            extent: 'parent' as const,
            ...(type === 'note' ? { style: { width: 280, height: 160 } } : {}),
          })
          autoConnect()
          checkAndDisableCapsuleIfNeeded(targetGroupId)
          setTimeout(() => {
            rfInstance.current?.fitView({ nodes: [{ id }], duration: 400, padding: 0.5, maxZoom: 1.2 })
          }, 50)
          setContextMenu(null)
          return
        }
      }

      addNode({
        id,
        type: NODE_TYPE_MAP[type],
        position: { x: contextMenu.flowX, y: contextMenu.flowY },
        data,
        ...(type === 'note' ? { style: { width: 280, height: 160 } } : {}),
      })
      autoConnect()
      setTimeout(() => {
        rfInstance.current?.fitView({ nodes: [{ id }], duration: 400, padding: 0.5, maxZoom: 1.2 })
      }, 50)
      setContextMenu(null)
    },
    [contextMenu, addNode, onConnect]
  )

  const handleConnectStart = useCallback((_: unknown, params: OnConnectStartParams) => {
    connectingNode.current = params.nodeId ?? null
    connectingHandle.current = params.handleId ?? null
  }, [])

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    if (!connectingNode.current) return
    if (!connectionState.isValid) {
      const clientX = 'clientX' in event ? event.clientX : (event as TouchEvent).changedTouches[0].clientX
      const clientY = 'clientY' in event ? event.clientY : (event as TouchEvent).changedTouches[0].clientY
      const elementUnder = document.elementFromPoint(clientX, clientY)
      const isOnHandle = !!(elementUnder?.closest('.react-flow__handle'))
      const nodeElement = elementUnder?.closest('.react-flow__node') as HTMLElement | null

      if (nodeElement && !isOnHandle) {
        // ノード本体上でドロップ → 互換性のある入力ハンドルへ自動接続
        const targetNodeId = nodeElement.getAttribute('data-id')
        if (targetNodeId && targetNodeId !== connectingNode.current) {
          const srcPortType = parsePortType(connectingHandle.current)
          // target ハンドルは data-handleid が "in-" で始まる（data-handletype 属性は存在しない）
          const handles = Array.from(
            nodeElement.querySelectorAll<HTMLElement>('.react-flow__handle')
          ).filter((el) => {
            const hid = el.getAttribute('data-handleid') ?? ''
            return hid.startsWith('in-') && el.style.display !== 'none'
          })

          for (const handleEl of handles) {
            const handleId = handleEl.getAttribute('data-handleid')
            if (isCompatiblePorts(srcPortType, parsePortType(handleId))) {
              onConnect({
                source: connectingNode.current!,
                sourceHandle: connectingHandle.current,
                target: targetNodeId,
                targetHandle: handleId,
              })
              connectingNode.current = null
              return
            }
          }
        }
      } else if (!nodeElement && !isOnHandle) {
        const flowPos = rfInstance.current?.screenToFlowPosition({ x: clientX, y: clientY }) ?? { x: clientX, y: clientY }
        const targetGroup = findGroupAtPosition(flowPos.x, flowPos.y, useCanvasStore.getState().nodes)
        setContextMenu({
          x: clientX,
          y: clientY,
          flowX: flowPos.x,
          flowY: flowPos.y,
          sourceNodeId: connectingNode.current ?? undefined,
          sourceHandleId: connectingHandle.current,
          sourcePortType: parsePortType(connectingHandle.current) as PortType,
          targetGroupId: targetGroup?.id,
        })
      }
    }
    connectingNode.current = null
  }, [onConnect])

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: AppNode[] }) => {
      setSelectedNode(selected.length === 1 ? selected[0].id : null)
    },
    [setSelectedNode]
  )

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: AppNode) => {
    if (node.type !== 'groupNode') return
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      flowX: 0,
      flowY: 0,
      groupNodeId: node.id,
    })
  }, [])

  const handleViewportChange = useCallback(
    (vp: Viewport) => setZoom(vp.zoom),
    [setZoom]
  )

  const handleNodeDragStart = useCallback(
    (event: React.MouseEvent, _node: AppNode, draggedNodes: AppNode[]) => {
      if (!event.altKey) {
        altDragActiveRef.current = false
        return
      }
      altDragActiveRef.current = true

      // ドラッグ開始直後にオリジナルをその場に残す（バックアップ作成）
      const { nodes: currentNodes, setNodes: storeSetNodes, edges: currentEdges, setEdges: storeSetEdges } = useCanvasStore.getState()
      const dragToBackup = new Map<string, string>()
      const draggedIds = new Set(draggedNodes.map((n) => n.id))
      const backupNodes: AppNode[] = draggedNodes.map((n) => {
        const backupId = `node-${Date.now()}-${nodeIdCounter++}`
        dragToBackup.set(n.id, backupId)
        // React Flow の内部プロパティ（positionAbsolute, handleBounds 等）を除いた
        // クリーンなノードオブジェクトを作成する
        return {
          id: backupId,
          type: n.type,
          position: { x: n.position.x, y: n.position.y },
          data: n.data,
          style: n.style,
          width: n.width,
          height: n.height,
          selected: false,
          dragging: false,
        } as AppNode
      })
      dragToBackupIdRef.current = dragToBackup

      // ドラッグされるノードに繋がっているエッジを記録し、
      // バックアップノード側に付け替える（ドラッグ中も元位置のエッジが見える）
      const connectedEdges = currentEdges.filter(
        (e) => draggedIds.has(e.source) || draggedIds.has(e.target)
      )
      originalEdgesRef.current = connectedEdges

      const updatedEdges = currentEdges.map((e) => {
        const srcInDrag = draggedIds.has(e.source)
        const tgtInDrag = draggedIds.has(e.target)
        if (!srcInDrag && !tgtInDrag) return e
        return {
          ...e,
          source: srcInDrag ? dragToBackup.get(e.source)! : e.source,
          target: tgtInDrag ? dragToBackup.get(e.target)! : e.target,
        }
      })

      storeSetNodes([...currentNodes, ...backupNodes])
      storeSetEdges(updatedEdges)
    },
    []
  )

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, _node: AppNode, draggedNodes: AppNode[]) => {
      if (!altDragActiveRef.current) {
        // 通常のドラッグ: グループ内に落としたノードを自動でグループに追加
        const currentState = useCanvasStore.getState()
        for (const draggedNode of draggedNodes) {
          if (draggedNode.type === 'groupNode') continue
          if (draggedNode.parentId) continue  // 既にグループ内

          const nodeInStore = currentState.nodes.find((n) => n.id === draggedNode.id)
          if (!nodeInStore) continue

          const nodeWidth = (nodeInStore.measured?.width ?? (nodeInStore.width as number | undefined) ?? 280)
          const nodeHeight = (nodeInStore.measured?.height ?? (nodeInStore.height as number | undefined) ?? 160)
          const centerX = nodeInStore.position.x + nodeWidth / 2
          const centerY = nodeInStore.position.y + nodeHeight / 2

          const targetGroup = findGroupAtPosition(centerX, centerY, currentState.nodes)
          if (!targetGroup) continue

          currentState.addNodeToGroup(nodeInStore.id, targetGroup.id)
          checkAndDisableCapsuleIfNeeded(targetGroup.id)
        }
        return
      }

      altDragActiveRef.current = false

      const { edges: currentEdges, setEdges: storeSetEdges } = useCanvasStore.getState()

      // ドラッグ開始時に記録した元エッジを、コピーノード（ドラッグしたノード）にも追加する
      // バックアップノード側のエッジはすでに dragStart で付け替え済み
      const copyEdges: Edge[] = originalEdgesRef.current.map((e) => ({
        id: `edge-${Date.now()}-${nodeIdCounter++}`,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        type: e.type,
        animated: e.animated ?? false,
        style: e.style,
        data: e.data,
        label: e.label,
        labelStyle: e.labelStyle,
        labelShowBg: e.labelShowBg,
        labelBgStyle: e.labelBgStyle,
        labelBgPadding: e.labelBgPadding,
        labelBgBorderRadius: e.labelBgBorderRadius,
        className: e.className,
        markerStart: e.markerStart,
        markerEnd: e.markerEnd,
      }))

      originalEdgesRef.current = []
      storeSetEdges([...currentEdges, ...copyEdges])
    },
    []
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes('application/node-palette') ||
      e.dataTransfer.types.includes('Files')
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()

      // 画像ファイルのドラッグ&ドロップ
      const imageFiles = Array.from(e.dataTransfer.files)
        .filter((f) => f.type.startsWith('image/'))
        .slice(0, 10)

      if (imageFiles.length > 0) {
        // 単一ファイルかつ既存の referenceImageNode へのドロップ → 画像を入れ替え
        if (imageFiles.length === 1) {
          const targetEl = e.target as Element
          const nodeEl = targetEl.closest('.react-flow__node') as HTMLElement | null
          const targetNodeId = nodeEl?.getAttribute('data-id') ?? null
          const targetNode = targetNodeId ? nodes.find((n) => n.id === targetNodeId) : null

          if (targetNode?.type === 'referenceImageNode') {
            const previewUrl = URL.createObjectURL(imageFiles[0])
            updateNode(targetNodeId!, { uploadedImagePreview: previewUrl } as Parameters<typeof updateNode>[1])
            fal.storage.upload(imageFiles[0]).then((uploadedUrl: string) => {
              updateNode(targetNodeId!, { imageUrl: uploadedUrl, uploadedImagePreview: previewUrl } as Parameters<typeof updateNode>[1])
            }).catch(() => {
              updateNode(targetNodeId!, { imageUrl: null, uploadedImagePreview: null } as Parameters<typeof updateNode>[1])
            })
            return
          }
        }

        // 新規 ReferenceImageNode を整列して生成（横一列、300px間隔）
        const basePos = rfInstance.current?.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        }) ?? { x: e.clientX, y: e.clientY }

        const NODE_SPACING = 300
        const totalWidth = NODE_SPACING * (imageFiles.length - 1)
        const startX = basePos.x - totalWidth / 2

        imageFiles.forEach((file, index) => {
          const nodeId = `node-${Date.now()}-${nodeIdCounter++}`
          const previewUrl = URL.createObjectURL(file)
          addNode({
            id: nodeId,
            type: 'referenceImageNode',
            position: { x: startX + index * NODE_SPACING, y: basePos.y },
            data: {
              ...REFERENCE_IMAGE_DEFAULT_DATA,
              label: 'Reference Image',
              uploadedImagePreview: previewUrl,
            } as unknown as NodeData,
          })
          fal.storage.upload(file).then((uploadedUrl: string) => {
            updateNode(nodeId, { imageUrl: uploadedUrl, uploadedImagePreview: previewUrl } as Parameters<typeof updateNode>[1])
          }).catch(() => {})
        })
        return
      }

      const raw = e.dataTransfer.getData('application/node-palette')
      if (!raw) return
      const { type, label } = JSON.parse(raw) as { type: NodeType; label: string }
      const flowPos = rfInstance.current?.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      }) ?? { x: e.clientX, y: e.clientY }

      const id = `node-${Date.now()}-${nodeIdCounter++}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any
      if (type === 'videoGen') {
        data = { ...VIDEO_GEN_DEFAULT_DATA, label }
      } else if (type === 'referenceImage') {
        data = { ...REFERENCE_IMAGE_DEFAULT_DATA, label }
      } else if (type === 'imageGen') {
        data = { ...IMAGE_GEN_DEFAULT_DATA, label }
      } else if (type === 'promptEnhancer') {
        data = { ...PROMPT_ENHANCER_DEFAULT_DATA, label }
      } else {
        data = { type, label, params: {}, status: 'idle' }
      }

      const targetGroup = findGroupAtPosition(flowPos.x, flowPos.y, useCanvasStore.getState().nodes)
      if (targetGroup) {
        const padding = 40
        const headerHeight = 28
        const nodeDefaultWidth = 280
        const nodeDefaultHeight = type === 'note' ? 160 : 160
        const relX = Math.max(padding, flowPos.x - targetGroup.position.x)
        const relY = Math.max(headerHeight + padding, flowPos.y - targetGroup.position.y)
        expandGroupIfNeeded(targetGroup.id, relX, relY, nodeDefaultWidth, nodeDefaultHeight, padding)
        addNode({
          id,
          type: NODE_TYPE_MAP[type],
          position: { x: relX, y: relY },
          data,
          parentId: targetGroup.id,
          extent: 'parent' as const,
          ...(type === 'note' ? { style: { width: 280, height: 160 } } : {}),
        })
        checkAndDisableCapsuleIfNeeded(targetGroup.id)
      } else {
        addNode({
          id,
          type: NODE_TYPE_MAP[type],
          position: flowPos,
          data,
          ...(type === 'note' ? { style: { width: 280, height: 160 } } : {}),
        })
      }
      setTimeout(() => {
        rfInstance.current?.fitView({ nodes: [{ id }], duration: 400, padding: 0.5, maxZoom: 1.2 })
      }, 50)
    },
    [addNode]
  )

  return (
    <div
      className="h-full w-full"
      style={{ background: canvasBg, position: 'relative' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isSpacePressed && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 9999,
            cursor: isPanning ? 'grabbing' : 'grab',
          }}
          onMouseDown={handleSpaceOverlayMouseDown}
          onMouseMove={handleSpaceOverlayMouseMove}
          onMouseUp={handleSpaceOverlayMouseUp}
          onMouseLeave={handleSpaceOverlayMouseUp}
        />
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onInit={(instance) => { rfInstance.current = instance; rfInstanceRef.current = instance }}
        onViewportChange={handleViewportChange}
        nodeTypes={nodeTypes}
        panOnDrag={[1, 2]}
        selectionOnDrag={true}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        panOnScroll={true}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomActivationKeyCode="Meta"
        deleteKeyCode={['Backspace', 'Delete']}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={() => setContextMenu(null)}
        onSelectionChange={handleSelectionChange}
        fitView
        minZoom={0.1}
        maxZoom={2.0}
        colorMode={isDark ? 'dark' : 'light'}
        style={{ background: canvasBg }}
        elevateEdgesOnSelect={false}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { stroke: isDark ? 'var(--border-active)' : '#C8C4BE', strokeWidth: 2 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color={dotColor}
          style={{ background: canvasBg }}
        />
        <Controls
          style={{
            background: surfaceBg,
            border: `1px solid ${borderCol}`,
            borderRadius: 9999,
            boxShadow: 'none',
          }}
        />
        {showMiniMap && (
          <MiniMap
            pannable
            nodeColor={(n) => {
              const type = (n.data as { type?: string })?.type
              if (type === 'image') return '#8B5CF6'
              if (type === 'video') return '#EC4899'
              if (type === 'utility') return '#6B7280'
              return '#6366F1'
            }}
            maskColor={isDark ? 'rgba(10,10,11,0.7)' : 'rgba(237,236,234,0.7)'}
            style={{
              background: surfaceBg,
              border: `1px solid ${borderCol}`,
              borderRadius: 8,
              bottom: 60,
              right: 16,
            }}
          />
        )}
      </ReactFlow>

      {/* ミニマップ トグルボタン */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 20,
        }}
      >
        <button
          ref={miniMapBtnRef}
          onClick={() => setShowMiniMap((v) => !v)}
          title={showMiniMap ? 'ミニマップを非表示' : 'ミニマップを表示'}
          style={{
            width: 36,
            height: 36,
            borderRadius: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 150ms ease-out',
            border: `1px solid ${borderCol}`,
            background: showMiniMap ? 'var(--accent)' : surfaceBg,
            color: showMiniMap ? '#fff' : 'var(--text-secondary)',
            boxShadow: 'none',
          }}
          onMouseEnter={(e) => {
            if (!showMiniMap) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
          }}
          onMouseLeave={(e) => {
            if (!showMiniMap) (e.currentTarget as HTMLElement).style.background = surfaceBg
          }}
        >
          <MapTrifold size={17} />
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onSelect={handleNodeSelect}
          onClose={() => setContextMenu(null)}
          sourcePortType={contextMenu.sourcePortType}
          groupNodeId={contextMenu.groupNodeId}
          onUngroup={(groupId) => {
            useCanvasStore.getState().ungroupNodes(groupId)
            setContextMenu(null)
          }}
        />
      )}
    </div>
  )
}
