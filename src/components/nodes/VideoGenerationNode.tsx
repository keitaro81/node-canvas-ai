import { memo, useCallback, useEffect, useRef } from 'react'
import { Handle, Position, useNodes, useEdges, type NodeProps } from '@xyflow/react'
import { Play, Loader2, AlertCircle, Film, Video, Minus, Plus } from 'lucide-react'
import type { Edge } from '@xyflow/react'
import { falVideoProvider } from '../../lib/ai/provider-registry'
import { useCanvasStore } from '../../stores/canvasStore'
import type { AppNode } from '../../stores/canvasStore'
import { getImageUrlFromNodeData } from '../../lib/utils'
import type { VideoGenerationNodeData, VideoDisplayNodeData, CapsuleFieldDef, CapsuleVisibility, NodeData } from '../../types/nodes'
import { CapsuleFieldToggle } from './CapsuleFieldToggle'
import type { VideoGenerationRequest, VideoGenerationProgress } from '../../lib/ai/types'
import { saveGeneration, checkQuota } from '../../lib/api/generations'
import { useWorkflowStore } from '../../stores/workflowStore'
import { uploadVideoFromUrl } from '../../lib/api/storage'
import { showToast } from '../../hooks/useToast'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const upd = (updateNode: (id: string, data: any) => void, id: string, patch: Record<string, unknown>) =>
  updateNode(id, patch)

const allVideoModels = falVideoProvider.getAvailableVideoModels()
const v2vModels = allVideoModels.filter((m) => m.supportedModes.includes('video-to-video'))
const nonV2vModels = allVideoModels.filter((m) => !m.supportedModes.every((mode) => mode === 'video-to-video'))

function VideoGenerationNodeInner({ id, data, selected }: NodeProps) {
  const updateNode = useCanvasStore((s) => s.updateNode)
  const nodeData = data as unknown as VideoGenerationNodeData
  const isRecoveringRef = useRef(false)

  const rfNodes = useNodes()
  const rfEdges = useEdges()

  const isGenerating = nodeData.status === 'queued' || nodeData.status === 'processing'
  const count = Math.max(1, Math.min(10, nodeData.count ?? 1))

  // 接続されている参照画像URLをリアクティブに取得
  const connectedImageUrl = (() => {
    const imageEdge = rfEdges.find((e) => e.target === id && e.targetHandle === 'in-image')
    if (!imageEdge) return null
    const sourceNode = rfNodes.find((n) => n.id === imageEdge.source)
    if (!sourceNode) return null
    return getImageUrlFromNodeData(sourceNode.data)
  })()

  const hasConnectedImageNode = rfEdges.some((e) => e.target === id && e.targetHandle === 'in-image')

  // 接続されている参照動画URLをリアクティブに取得
  const connectedVideoUrl = (() => {
    const videoEdge = rfEdges.find((e) => e.target === id && e.targetHandle === 'in-video')
    if (!videoEdge) return null
    const sourceNode = rfNodes.find((n) => n.id === videoEdge.source)
    if (!sourceNode) return null
    const d = sourceNode.data as Record<string, unknown>
    return (d.videoUrl as string | null) ?? null
  })()

  const isV2VMode = !!connectedVideoUrl

  const availableModels = isV2VMode
    ? v2vModels
    : nonV2vModels.filter((m) =>
        hasConnectedImageNode
          ? m.supportedModes.includes('image-to-video')
          : !m.supportedModes.every((mode) => mode === 'image-to-video')
      )
  const currentModel = (() => {
    const found = availableModels.find((m) => m.id === nodeData.model)
    if (found) return found
    return availableModels[0]
  })()

  const getConnectedPrompt = useCallback((): string | null => {
    const { edges, nodes } = useCanvasStore.getState()
    const incomingEdges = edges.filter((e) => e.target === id && e.targetHandle === 'in-text')
    if (incomingEdges.length === 0) return null
    const prompts = incomingEdges
      .map((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source)
        const d = sourceNode?.data as Record<string, unknown> | undefined
        if (sourceNode?.type === 'promptEnhancerNode' && d?.status === 'error') return null
        return ((d?.params as Record<string, unknown> | undefined)?.prompt as string)
          || (d?.outputText as string)
          || null
      })
      .filter((p): p is string => !!p && p.trim() !== '')
    return prompts.length > 0 ? prompts.join('\n\n') : null
  }, [id])

  const handleGenerate = useCallback(async () => {
    const quota = await checkQuota('video')
    if (!quota.allowed) {
      upd(updateNode, id, { status: 'failed', error: `動画生成の上限（${quota.limit}本）に達しました（${quota.used}/${quota.limit}本使用済み）` })
      return
    }

    const prompt = getConnectedPrompt()
    if (!prompt) {
      upd(updateNode, id, { status: 'failed', error: 'プロンプトを入力してください' })
      return
    }
    if (hasConnectedImageNode && !connectedImageUrl) {
      upd(updateNode, id, { status: 'failed', error: '参照画像をアップロードしてください' })
      return
    }

    const mode = connectedVideoUrl ? 'video-to-video' : connectedImageUrl ? 'image-to-video' : 'text-to-video'
    const modelForMode = currentModel

    const { nodes: allNodes, edges: allEdges, addNode, setEdges } = useCanvasStore.getState()
    const thisNode = allNodes.find((n) => n.id === id)
    if (!thisNode) return

    // 既存の接続済み VideoDisplayNode の最下端 y を求めて配置開始位置を決める
    const existingDisplayNodes = allEdges
      .filter((e) => e.source === id && e.sourceHandle === 'out-video')
      .map((e) => allNodes.find((n) => n.id === e.target))
      .filter((n): n is AppNode => n?.type === 'videoDisplayNode')

    const genWidth = 280
    const hGap = 40
    const vGap = 10
    const displayNodeEstimatedHeight = 400

    const startY = existingDisplayNodes.length > 0
      ? Math.max(...existingDisplayNodes.map((n) => n.position.y)) + displayNodeEstimatedHeight + vGap
      : thisNode.position.y

    // count 個の VideoDisplayNode を新規作成
    const displayIds: string[] = []
    const newEdges: Edge[] = []

    for (let i = 0; i < count; i++) {
      const displayId = `node-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`
      displayIds.push(displayId)

      addNode({
        id: displayId,
        type: 'videoDisplayNode',
        position: {
          x: thisNode.position.x + genWidth + hGap,
          y: startY + i * (displayNodeEstimatedHeight + vGap),
        },
        data: {
          label: 'Video Result',
          videoUrl: null,
          fileName: null,
          autoPlay: false,
          loop: true,
          muted: false,
          status: 'queued',
          progress: 'キュー待ち...',
          error: null,
        } as unknown as VideoDisplayNodeData,
        ...(thisNode.parentId ? { parentId: thisNode.parentId } : {}),
      } as unknown as AppNode)

      newEdges.push({
        id: `e-gen-${id}-disp-${displayId}`,
        source: id,
        sourceHandle: 'out-video',
        target: displayId,
        targetHandle: 'in-video',
        style: { stroke: '#EC4899', strokeWidth: 2 },
        animated: false,
        className: '',
      } as Edge)
    }

    const { edges: latestEdges } = useCanvasStore.getState()
    setEdges([...latestEdges, ...newEdges])

    upd(updateNode, id, {
      status: 'queued',
      progress: 'キュー待ち...',
      error: null,
      requestId: null,
      requestEndpoint: null,
      activeDisplayNodeId: displayIds[0],
    })

    const baseRequest: VideoGenerationRequest = {
      prompt,
      model: modelForMode?.id ?? nodeData.model,
      duration: nodeData.duration as VideoGenerationRequest['duration'],
      resolution: nodeData.resolution as VideoGenerationRequest['resolution'],
      aspectRatio: nodeData.aspectRatio as VideoGenerationRequest['aspectRatio'],
      fps: nodeData.fps as VideoGenerationRequest['fps'],
      audioEnabled: nodeData.audioEnabled,
      seed: nodeData.seed,
      mode,
      ...(mode === 'video-to-video' && connectedVideoUrl ? { videoUrl: connectedVideoUrl, ...(connectedImageUrl ? { imageUrl: connectedImageUrl } : {}) } : {}),
      ...(mode === 'image-to-video' && connectedImageUrl ? { imageUrl: connectedImageUrl } : {}),
    }

    // count 分を並列生成
    await Promise.all(displayIds.map(async (displayId, i) => {
      const onProgress = (progress: VideoGenerationProgress) => {
        if (progress.status === 'IN_QUEUE') {
          upd(updateNode, displayId, { status: 'queued', progress: 'キュー待ち...' })
          if (i === 0) upd(updateNode, id, { status: 'queued', progress: 'キュー待ち...' })
        } else if (progress.status === 'IN_PROGRESS') {
          const latestLog = progress.logs?.[progress.logs.length - 1] || '生成中...'
          upd(updateNode, displayId, { status: 'processing', progress: latestLog })
          if (i === 0) upd(updateNode, id, { status: 'processing', progress: latestLog })
        }
      }

      const onRequestId = (requestId: string, endpoint: string) => {
        if (i === 0) {
          upd(updateNode, id, { requestId, requestEndpoint: endpoint })
          useWorkflowStore.getState().saveCurrentWorkflow()
        }
      }

      try {
        const result = await falVideoProvider.generateVideo(baseRequest, onProgress, onRequestId)

        if (result.status === 'completed' && result.videoUrl) {
          upd(updateNode, displayId, {
            status: 'completed',
            progress: '',
            videoUrl: result.videoUrl,
            fileName: result.fileName ?? null,
            error: null,
          })
          uploadVideoFromUrl(result.videoUrl, displayId).then((storedUrl) => {
            upd(updateNode, displayId, { videoUrl: storedUrl })
          }).catch(() => {
            showToast('動画の保存に失敗しました。一時URLは期限切れになる可能性があります。', 'warning')
          })
          if (i === 0) useWorkflowStore.getState().updateThumbnail(result.videoUrl)
          saveGeneration({
            nodeId: id,
            nodeType: 'video-generation',
            provider: 'fal',
            model: modelForMode?.id ?? nodeData.model,
            status: 'completed',
            outputUrl: result.videoUrl,
            inputParams: {
              prompt,
              model: modelForMode?.id ?? nodeData.model,
              mode,
              duration: nodeData.duration,
              resolution: nodeData.resolution,
              aspectRatio: nodeData.aspectRatio,
              ...(mode === 'image-to-video' ? { imageUrl: connectedImageUrl } : {}),
            },
          })
        } else {
          upd(updateNode, displayId, { status: 'failed', progress: '', error: result.error || '生成に失敗しました' })
          saveGeneration({
            nodeId: id,
            nodeType: 'video-generation',
            provider: 'fal',
            model: modelForMode?.id ?? nodeData.model,
            status: 'failed',
            errorMessage: result.error || '生成に失敗しました',
            inputParams: { prompt, model: modelForMode?.id ?? nodeData.model, mode },
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '予期しないエラー'
        upd(updateNode, displayId, { status: 'failed', progress: '', error: errorMessage })
        saveGeneration({
          nodeId: id,
          nodeType: 'video-generation',
          provider: 'fal',
          model: currentModel?.id ?? nodeData.model,
          status: 'failed',
          errorMessage,
          inputParams: { prompt, model: currentModel?.id ?? nodeData.model, mode },
        })
      }
    }))

    upd(updateNode, id, {
      status: 'idle',
      progress: '',
      error: null,
      requestId: null,
      requestEndpoint: null,
      activeDisplayNodeId: null,
    })
  }, [id, count, nodeData, currentModel, connectedImageUrl, connectedVideoUrl, hasConnectedImageNode, getConnectedPrompt, updateNode])

  useEffect(() => {
    function onCapsuleGenerate(e: Event) {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail
      if (nodeId === id) handleGenerate()
    }
    window.addEventListener('capsule:generate', onCapsuleGenerate)
    return () => window.removeEventListener('capsule:generate', onCapsuleGenerate)
  }, [id, handleGenerate])

  const capsuleFields = ((data as unknown as NodeData).capsuleFields ?? {}) as Record<string, CapsuleFieldDef>
  function getCapsuleVisibility(fieldId: string): CapsuleVisibility {
    return capsuleFields[fieldId]?.capsuleVisibility ?? 'visible'
  }
  function handleCapsuleChange(fieldId: string, visibility: CapsuleVisibility) {
    const updated: Record<string, CapsuleFieldDef> = {
      ...capsuleFields,
      [fieldId]: { id: fieldId, capsuleVisibility: visibility },
    }
    updateNode(id, { capsuleFields: updated } as Partial<NodeData>)
  }

  // ページリロード後のリカバリー
  useEffect(() => {
    if (isRecoveringRef.current) return
    const snap = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as VideoGenerationNodeData | undefined
    const initStatus = snap?.status
    const initRequestId = snap?.requestId
    const initEndpoint = snap?.requestEndpoint ?? null
    const initDisplayId = snap?.activeDisplayNodeId ?? null

    if (
      (initStatus === 'queued' || initStatus === 'processing') &&
      initRequestId &&
      initEndpoint
    ) {
      isRecoveringRef.current = true

      // activeDisplayNodeId から DisplayNode を特定。なければ接続エッジから検索
      const displayId = initDisplayId ?? (() => {
        const { edges, nodes } = useCanvasStore.getState()
        const edge = edges.find((e) => e.source === id && e.sourceHandle === 'out-video')
        const target = edge?.target
        return nodes.find((n) => n.id === target && n.type === 'videoDisplayNode')?.id ?? null
      })()

      if (displayId) upd(updateNode, displayId, { progress: '復元中...' })
      upd(updateNode, id, { progress: '復元中...' })

      const onProgress = (progress: VideoGenerationProgress) => {
        if (progress.status === 'IN_QUEUE') {
          if (displayId) upd(updateNode, displayId, { status: 'queued', progress: 'キュー待ち（復元）...' })
          upd(updateNode, id, { status: 'queued', progress: 'キュー待ち（復元）...' })
        } else if (progress.status === 'IN_PROGRESS') {
          const latestLog = progress.logs?.[progress.logs.length - 1] || '生成中（復元）...'
          if (displayId) upd(updateNode, displayId, { status: 'processing', progress: latestLog })
          upd(updateNode, id, { status: 'processing', progress: latestLog })
        }
      }

      falVideoProvider.recoverVideo(initRequestId, initEndpoint, onProgress)
        .then((result) => {
          if (result.status === 'completed' && result.videoUrl) {
            if (displayId) upd(updateNode, displayId, {
              status: 'completed',
              progress: '',
              videoUrl: result.videoUrl,
              fileName: result.fileName ?? null,
              error: null,
            })
            upd(updateNode, id, {
              status: 'idle',
              progress: '',
              error: null,
              requestId: null,
              requestEndpoint: null,
              activeDisplayNodeId: null,
            })
            uploadVideoFromUrl(result.videoUrl, displayId ?? id).then((storedUrl) => {
              if (displayId) upd(updateNode, displayId, { videoUrl: storedUrl })
            }).catch(() => {
              showToast('動画の保存に失敗しました。一時URLは期限切れになる可能性があります。', 'warning')
            })
            useWorkflowStore.getState().updateThumbnail(result.videoUrl)
          } else {
            if (displayId) upd(updateNode, displayId, { status: 'failed', progress: '', error: result.error || '生成に失敗しました' })
            upd(updateNode, id, {
              status: 'failed',
              progress: '',
              error: result.error || '生成に失敗しました',
              requestId: null,
              requestEndpoint: null,
            })
          }
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : '復元に失敗しました'
          if (displayId) upd(updateNode, displayId, { status: 'failed', progress: '', error: errorMessage })
          upd(updateNode, id, {
            status: 'failed',
            progress: '',
            error: errorMessage,
            requestId: null,
            requestEndpoint: null,
          })
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // capsuleFields に未登録のフィールドを 'visible' で初期化する
  useEffect(() => {
    const defaultFields = ['model', 'duration', 'resolution', 'aspectRatio', 'audioEnabled']
    const current = ((useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as NodeData | undefined)
      ?.capsuleFields as Record<string, CapsuleFieldDef> | undefined) ?? {}
    const missing = defaultFields.filter((f) => !(f in current))
    if (missing.length === 0) return
    const updated = { ...current }
    missing.forEach((f) => { updated[f] = { id: f, capsuleVisibility: 'visible' } })
    updateNode(id, { capsuleFields: updated } as Partial<NodeData>)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div
      className={[
        'node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible border transition-all duration-150',
        isGenerating
          ? 'node-generating border-[#EC4899] shadow-[0_0_0_1px_rgba(236,72,153,0.3)]'
          : selected
          ? 'border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
          : 'border-[var(--border)]',
      ].join(' ')}
      style={{ background: 'var(--bg-surface)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]" style={{ minHeight: 36 }}>
        <Film size={14} className="shrink-0" style={{ color: '#EC4899' }} />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{nodeData.label}</span>
      </div>

      {/* Text input handle */}
      <Handle
        id="in-text"
        type="target"
        position={Position.Left}
        style={{
          top: '30%',
          width: 20,
          height: 20,
          background: 'radial-gradient(circle, #6366F1 3px, var(--bg-surface) 3px 5px, transparent 5px)',
          border: 'none',
          borderRadius: 0,
        }}
      />

      {/* Image input handle */}
      <Handle
        id="in-image"
        type="target"
        position={Position.Left}
        style={{
          top: '55%',
          width: 20,
          height: 20,
          background: 'radial-gradient(circle, #8B5CF6 3px, var(--bg-surface) 3px 5px, transparent 5px)',
          border: 'none',
          borderRadius: 0,
        }}
      />

      {/* Video input handle */}
      <Handle
        id="in-video"
        type="target"
        position={Position.Left}
        style={{
          top: '75%',
          width: 20,
          height: 20,
          background: 'radial-gradient(circle, #EC4899 3px, var(--bg-surface) 3px 5px, transparent 5px)',
          border: 'none',
          borderRadius: 0,
        }}
      />

      {/* Body */}
      <div className="px-3 py-3 flex flex-col gap-2">

        {/* Mode indicator */}
        {connectedVideoUrl && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
            style={{ background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.3)', color: '#EC4899' }}
          >
            <Video size={11} />
            参照動画あり → Video to Video
          </div>
        )}
        {!connectedVideoUrl && hasConnectedImageNode && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
            style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#8B5CF6' }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
            参照画像あり → Image to Video
          </div>
        )}

        {/* Model */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Model</label>
            <CapsuleFieldToggle fieldId="model" visibility={getCapsuleVisibility('model')} onChange={handleCapsuleChange} />
          </div>
          <select
            className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
            style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
            value={currentModel?.id ?? ''}
            onChange={(e) => {
              const newModel = allVideoModels.find((m) => m.id === e.target.value)
              if (!newModel) return
              const patch: Record<string, unknown> = { model: newModel.id }
              if (!newModel.supportedDurations.includes(nodeData.duration)) {
                patch.duration = newModel.supportedDurations[0]
              }
              if (!newModel.supportedResolutions.includes(nodeData.resolution as never)) {
                patch.resolution = newModel.supportedResolutions[0]
              }
              if (!newModel.supportedAspectRatios.includes(nodeData.aspectRatio as never)) {
                patch.aspectRatio = newModel.supportedAspectRatios[0]
              }
              if (newModel.supportedFps && !newModel.supportedFps.includes(nodeData.fps)) {
                patch.fps = newModel.supportedFps[0]
              }
              upd(updateNode, id, patch)
            }}
            disabled={isGenerating}
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        {/* Duration */}
        {currentModel && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Duration: {nodeData.duration}s</label>
              <CapsuleFieldToggle fieldId="duration" visibility={getCapsuleVisibility('duration')} onChange={handleCapsuleChange} />
            </div>
            <select
              className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
              style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
              value={nodeData.duration}
              onChange={(e) => upd(updateNode, id, { duration: e.target.value })}
              disabled={isGenerating}
            >
              {currentModel.supportedDurations.map((d) => (
                <option key={d} value={d}>{d === 'auto' ? 'auto' : `${d}秒`}</option>
              ))}
            </select>
          </div>
        )}

        {/* Resolution */}
        {currentModel && currentModel.supportedResolutions.length > 1 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Resolution</label>
              <CapsuleFieldToggle fieldId="resolution" visibility={getCapsuleVisibility('resolution')} onChange={handleCapsuleChange} />
            </div>
            <select
              className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
              style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
              value={nodeData.resolution}
              onChange={(e) => upd(updateNode, id, { resolution: e.target.value })}
              disabled={isGenerating}
            >
              {currentModel.supportedResolutions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}

        {/* FPS */}
        {currentModel?.supportedFps && currentModel.supportedFps.length > 1 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">FPS</label>
            </div>
            <select
              className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
              style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
              value={nodeData.fps ?? 25}
              onChange={(e) => upd(updateNode, id, { fps: Number(e.target.value) })}
              disabled={isGenerating}
            >
              {currentModel.supportedFps.map((f) => (
                <option key={f} value={f}>{f} fps</option>
              ))}
            </select>
          </div>
        )}

        {/* Aspect Ratio — 画像参照接続時は非表示（モデルが画像サイズを優先するため） */}
        {currentModel && !hasConnectedImageNode && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Aspect Ratio</label>
              <CapsuleFieldToggle fieldId="aspectRatio" visibility={getCapsuleVisibility('aspectRatio')} onChange={handleCapsuleChange} />
            </div>
            <select
              className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
              style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
              value={nodeData.aspectRatio}
              onChange={(e) => upd(updateNode, id, { aspectRatio: e.target.value })}
              disabled={isGenerating}
            >
              {(hasConnectedImageNode && currentModel.i2vSupportedAspectRatios
                ? currentModel.i2vSupportedAspectRatios
                : currentModel.supportedAspectRatios
              ).map((ar) => (
                <option key={ar} value={ar}>{ar}</option>
              ))}
            </select>
          </div>
        )}

        {/* Audio toggle */}
        {currentModel?.features.includes('audio') && (
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-[var(--text-secondary)]">Audio</label>
            <button
              className="relative w-8 h-4 rounded-full transition-colors nodrag"
              style={{ background: nodeData.audioEnabled ? '#EC4899' : 'var(--border-active)' }}
              onClick={() => upd(updateNode, id, { audioEnabled: !nodeData.audioEnabled })}
              disabled={isGenerating}
            >
              <div
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                style={{ left: nodeData.audioEnabled ? '18px' : '2px' }}
              />
            </button>
          </div>
        )}

        {/* Progress */}
        {isGenerating && (
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px]"
            style={{ background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.2)', color: '#EC4899' }}
          >
            <Loader2 size={12} className="animate-spin shrink-0" />
            {nodeData.progress}
          </div>
        )}

        {/* Error */}
        {nodeData.status === 'failed' && nodeData.error && (
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px]"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444' }}
          >
            <AlertCircle size={12} className="shrink-0" />
            {nodeData.error}
          </div>
        )}

        {/* Count stepper */}
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-[var(--text-secondary)]">Count</label>
          <div className="flex items-center gap-1">
            <button
              className="w-6 h-6 rounded flex items-center justify-center nodrag transition-colors"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
              onClick={() => upd(updateNode, id, { count: Math.max(1, count - 1) })}
              disabled={isGenerating}
            >
              <Minus size={10} />
            </button>
            <span className="text-[12px] font-semibold text-[var(--text-primary)] w-6 text-center tabular-nums">{count}</span>
            <button
              className="w-6 h-6 rounded flex items-center justify-center nodrag transition-colors"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
              onClick={() => upd(updateNode, id, { count: Math.min(10, count + 1) })}
              disabled={isGenerating}
            >
              <Plus size={10} />
            </button>
          </div>
        </div>

        {/* Generate button */}
        <button
          className="w-full h-9 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 transition-all nodrag"
          style={{
            background: isGenerating ? 'rgba(236,72,153,0.35)' : '#EC4899',
            opacity: isGenerating ? 0.7 : 1,
            cursor: isGenerating ? 'not-allowed' : 'pointer',
          }}
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Play size={14} />
              Generate Video
            </>
          )}
        </button>
      </div>

      {/* Output handle */}
      <Handle
        id="out-video"
        type="source"
        position={Position.Right}
        style={{
          top: '50%',
          width: 20,
          height: 20,
          background: 'radial-gradient(circle, #EC4899 3px, var(--bg-surface) 3px 5px, transparent 5px)',
          border: 'none',
          borderRadius: 0,
        }}
      />
    </div>
  )
}

export const VideoGenerationNode = memo(function VideoGenerationNodeWrapper(props: NodeProps) {
  return (
    <div className="group">
      <VideoGenerationNodeInner {...props} />
    </div>
  )
})
