import { useCallback, useState, useRef, useEffect } from 'react'
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
import type { NodeType, NodeData, VideoGenerationNodeData, ReferenceImageNodeData } from '../../types/nodes'
import { fal } from '../../lib/ai/fal-client'

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
}

let nodeIdCounter = 1

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

export function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, setSelectedNode, setZoom } =
    useCanvasStore()

  const isLoadingWorkflow = useWorkflowStore((s) => s.isLoadingWorkflow)
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const rfInstance = useRef<ReactFlowInstance<AppNode, Edge> | null>(null)
  const connectingNode = useRef<string | null>(null)
  const connectingHandle = useRef<string | null>(null)
  const lastFitWorkflowId = useRef<string | null>(null)

  // Space キー押下でパン用カーソルに切り替え（react-flow__pane に直接スタイル注入）
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'space-pan-cursor'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        style.textContent = [
          '.react-flow__pane { cursor: grab !important; }',
          '.react-flow__pane:active { cursor: grabbing !important; }',
          '.react-flow__node { pointer-events: none !important; cursor: grab !important; }',
        ].join(' ')
        document.head.appendChild(style)
      }
      if (e.code === 'Digit0' && e.metaKey && e.altKey) {
        e.preventDefault()
        rfInstance.current?.fitView({ padding: 0.15, duration: 400 })
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') style.remove()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      style.remove()
    }
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

  const handlePaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault()
    const clientX = 'clientX' in e ? e.clientX : 0
    const clientY = 'clientY' in e ? e.clientY : 0
    const flowPos = rfInstance.current?.screenToFlowPosition({ x: clientX, y: clientY }) ?? { x: clientX, y: clientY }

    setContextMenu({
      x: clientX,
      y: clientY,
      flowX: flowPos.x,
      flowY: flowPos.y,
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
      addNode({
        id,
        type: NODE_TYPE_MAP[type],
        position: { x: contextMenu.flowX, y: contextMenu.flowY },
        data,
        ...(type === 'note' ? { style: { width: 280, height: 160 } } : {}),
      })
      setContextMenu(null)
    },
    [contextMenu, addNode]
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
        // キャンバス上でドロップ → コンテキストメニュー表示
        const flowPos = rfInstance.current?.screenToFlowPosition({ x: clientX, y: clientY }) ?? { x: clientX, y: clientY }
        setContextMenu({ x: clientX, y: clientY, flowX: flowPos.x, flowY: flowPos.y })
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

  const handleViewportChange = useCallback(
    (vp: Viewport) => setZoom(vp.zoom),
    [setZoom]
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

      // 画像ファイルのドラッグ&ドロップ → ReferenceImageNode を自動生成
      const imageFile = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith('image/')
      )
      if (imageFile) {
        const flowPos = rfInstance.current?.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        }) ?? { x: e.clientX, y: e.clientY }
        const nodeId = `node-${Date.now()}-${nodeIdCounter++}`
        const previewUrl = URL.createObjectURL(imageFile)
        addNode({
          id: nodeId,
          type: 'referenceImageNode',
          position: flowPos,
          data: {
            ...REFERENCE_IMAGE_DEFAULT_DATA,
            label: 'Reference Image',
            uploadedImagePreview: previewUrl,
          } as unknown as NodeData,
        })
        // バックグラウンドでfal.storageにアップロード
        fal.storage.upload(imageFile).then((uploadedUrl: string) => {
          const { updateNode } = useCanvasStore.getState()
          updateNode(nodeId, { imageUrl: uploadedUrl, uploadedImagePreview: previewUrl } as Parameters<typeof updateNode>[1])
        }).catch(() => {})
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
      addNode({
        id,
        type: NODE_TYPE_MAP[type],
        position: flowPos,
        data,
        ...(type === 'note' ? { style: { width: 280, height: 160 } } : {}),
      })
    },
    [addNode]
  )

  return (
    <div
      className="h-full w-full"
      style={{ background: '#0A0A0B' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onInit={(instance) => { rfInstance.current = instance }}
        onViewportChange={handleViewportChange}
        nodeTypes={nodeTypes}
        panOnDrag={[1, 2]}
        selectionOnDrag={true}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        panActivationKeyCode="Space"
        panOnScroll={true}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomActivationKeyCode="Meta"
        deleteKeyCode={['Backspace', 'Delete']}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={() => setContextMenu(null)}
        onSelectionChange={handleSelectionChange}
        fitView
        minZoom={0.1}
        maxZoom={2.0}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { stroke: '#3F3F46', strokeWidth: 2 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="#2A2A30"
          style={{ background: '#0A0A0B' }}
        />
        <Controls
          style={{
            background: '#111113',
            border: '1px solid #27272A',
            borderRadius: 8,
          }}
        />
        <MiniMap
          nodeColor={(n) => {
            const type = (n.data as { type?: string })?.type
            if (type === 'image') return '#8B5CF6'
            if (type === 'video') return '#EC4899'
            if (type === 'utility') return '#6B7280'
            return '#6366F1'
          }}
          maskColor="rgba(10,10,11,0.7)"
          style={{
            background: '#111113',
            border: '1px solid #27272A',
            borderRadius: 8,
          }}
        />
      </ReactFlow>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onSelect={handleNodeSelect}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
