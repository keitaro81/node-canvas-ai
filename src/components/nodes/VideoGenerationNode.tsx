import { Fragment, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Handle, Position, useNodes, useEdges, type NodeProps } from '@xyflow/react'
import { PortLabel } from './PortLabel'
import { dimIfNotTarget, useDragTarget } from './portDrag'
import { Play, Loader2, AlertCircle, Film, Video, Minus, Plus, X, Images, Clapperboard, Trash2 } from 'lucide-react'
import type { Edge } from '@xyflow/react'
import { falVideoProvider } from '../../lib/ai/provider-registry'
import { useCanvasStore } from '../../stores/canvasStore'
import type { AppNode } from '../../stores/canvasStore'
import { getImageUrlFromNodeData } from '../../lib/utils'
import { BatchMark } from './BatchMark'
import { CUT_ROLE_LABEL, type CutRole, hasTurnPreset, turnPreset, withTurnMotion, withTurnNegative } from '../../lib/video/productVideo'
import { VIDEO_GEN_END_HANDLE, VIDEO_GEN_START_HANDLE, cfgScaleOf, imageRoleOfSource, videoPromptOf, videoPromptSources, type SnapshotEdge, type SnapshotNode, type TaskInputs, type WorkflowSnapshot } from '../../lib/batch/plan'
import { VIDEO_GEN_ELEMENT_HANDLES, videoGenElements, type VideoGenElements } from '../../lib/video/klingElement'
import { listItemsOf, type ListMode } from '../../lib/listItems'
import { textsNeedingTranslation } from '../../lib/video/translate'
import { translateTextsClient } from '../../lib/video/translateClient'
import type { VideoGenerationNodeData, VideoDisplayNodeData, CapsuleFieldDef, CapsuleVisibility, NodeData } from '../../types/nodes'
import { CapsuleFieldToggle } from './CapsuleFieldToggle'
import type { VideoGenerationRequest, VideoGenerationProgress, VideoShot } from '../../lib/ai/types'
import { shotsTotalSeconds, SHOT_MAX, SHOT_MIN, TOTAL_MAX, TOTAL_MIN } from '../../lib/ai/videoShots'
import { saveGeneration, updateGeneration, checkQuota } from '../../lib/api/generations'
import { useWorkflowStore } from '../../stores/workflowStore'
import { uploadVideoFromUrl, signOwnUpload } from '../../lib/api/storage'
import { showToast } from '../../hooks/useToast'
import { patchWorkflowNodeOutput } from '../../lib/api/workflows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const upd = (updateNode: (id: string, data: any) => void, id: string, patch: Record<string, unknown>) =>
  updateNode(id, patch)

function isContentPolicyError(error: unknown): boolean {
  if (error instanceof Error) {
    if ((error as { status?: number }).status === 422) return true
    const lower = error.message.toLowerCase()
    if (lower.includes('content_policy_violation') || lower.includes('likenesses of real people') ||
        lower.includes('private information') || lower.includes('unprocessable')) return true
  }
  return false
}

function isNetworkTimeout(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('timeout') || lower.includes('timed_out') || lower.includes('timed out') ||
    lower.includes('failed to fetch') || lower.includes('network request failed') ||
    lower.includes('err_timed_out') || lower.includes('econnreset')
}

const EMPTY_SHOTS: VideoShot[] = []
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

  // 開始フレーム（in-image）: 上流の画像（Cut Set Input の役割ポートなら辺の sourceHandle で引く）
  const startEdge = rfEdges.find((e) => e.target === id && e.targetHandle === VIDEO_GEN_START_HANDLE)
  const startSource = startEdge ? rfNodes.find((n) => n.id === startEdge.source) : undefined
  const connectedImageUrl = startSource ? getImageUrlFromNodeData(startSource.data, startEdge?.sourceHandle) : null
  // 始点・終点の向き（Cut Set Input の役割ポート / Try-On のモデルの向き・その結果ノード）: 回転指示の自動生成に使う（設計 §4.2・2b-4）
  const startRole: CutRole | null = startEdge ? imageRoleOfSource(rfNodes as unknown as SnapshotNode[], rfEdges as unknown as SnapshotEdge[], startEdge.source, startEdge.sourceHandle) : null

  const hasConnectedImageNode = !!startEdge

  // Kling の参照一式（2026-11-02 メモ 42 案 B）: 「参照一式」ポート 1〜3 につないだ Kling Element の写真を集める（向きによる見えない自動の選択は廃止）
  const elementInfoKey = JSON.stringify(videoGenElements(rfNodes, rfEdges, id))
  const elementInfo = useMemo(() => JSON.parse(elementInfoKey) as VideoGenElements, [elementInfoKey])
  // List（2026-11-02 メモ 40）: 動画 → 参照動画、画像 → 開始フレーム、テキスト → 動きの指示として、項目ごとに 1 本ずつ作る
  const listEdge = rfEdges.find((e) => e.target === id && e.targetHandle === 'in-list')
  const hasList = !!listEdge
  const listInfoKey = JSON.stringify(listItemsOf(rfNodes, rfEdges, listEdge?.source))
  const listInfo = useMemo(() => JSON.parse(listInfoKey) as { mode: ListMode; items: string[] }, [listInfoKey])
  const hasImageInput = hasConnectedImageNode || listInfo.mode === 'image'
  const shots: VideoShot[] = nodeData.shots ?? EMPTY_SHOTS

  // 終了フレーム（in-image-end）
  const endEdge = rfEdges.find((e) => e.target === id && e.targetHandle === VIDEO_GEN_END_HANDLE)
  const endSource = endEdge ? rfNodes.find((n) => n.id === endEdge.source) : undefined
  const connectedEndImageUrl = endSource ? getImageUrlFromNodeData(endSource.data, endEdge?.sourceHandle) : null
  const endRole: CutRole | null = endEdge ? imageRoleOfSource(rfNodes as unknown as SnapshotNode[], rfEdges as unknown as SnapshotEdge[], endEdge.source, endEdge.sourceHandle) : null

  // 接続されている参照動画URLをリアクティブに取得
  const connectedVideoUrl = (() => {
    const videoEdge = rfEdges.find((e) => e.target === id && e.targetHandle === 'in-video')
    if (!videoEdge) return null
    const sourceNode = rfNodes.find((n) => n.id === videoEdge.source)
    if (!sourceNode) return null
    const d = sourceNode.data as Record<string, unknown>
    return (d.videoUrl as string | null) ?? null
  })()

  const isV2VMode = !!connectedVideoUrl || listInfo.mode === 'video'

  const availableModels = isV2VMode
    ? v2vModels
    : nonV2vModels.filter((m) =>
        hasImageInput
          ? m.supportedModes.includes('image-to-video')
          : !m.supportedModes.every((mode) => mode === 'image-to-video')
      )
  const currentModel = (() => {
    const found = availableModels.find((m) => m.id === nodeData.model)
    if (found) return found
    return availableModels[0]
  })()

  const supportsEndImage = !!currentModel?.endImageParam
  const supportsElements = !!currentModel?.features.includes('elements')
  const supportsShots = !!currentModel?.features.includes('multi-shot')
  // 開始フレーム: in-image があればそれ、無ければ参照カットの正面（カットだけつないでも動かせる）
  const startImageUrl = connectedImageUrl
  const activeShots = useMemo(() => (supportsShots ? shots.filter((x) => x.prompt.trim() !== '') : EMPTY_SHOTS), [supportsShots, shots])
  const shotsSeconds = shotsTotalSeconds(activeShots)

  // 商品動画向けの設定（動き / 避けたいこと）。始点と終点の向きが違うのに回転の定型文が無ければ、入れるボタンを出す（トグルで裏で付けるのはやめた・2026-11-01）
  const vp = (nodeData.params ?? {}) as { prompt?: string; negativePrompt?: string; autoTurn?: boolean; cfgScale?: number }
  const drag = useDragTarget(id, 'videoGenerationNode')   // 線のドラッグ中のポート名（メモ 31）
  const setParam = (patch: Partial<typeof vp>) => upd(updateNode, id, { params: { ...vp, ...patch } })
  const supportsNegative = currentModel?.paramStyle === 'kling' || currentModel?.paramStyle === 'kling-o3-i2v'
  const turnApplies = !!startRole && !!endRole && startRole !== endRole
  const turnMissing = turnApplies && !hasTurnPreset(vp.prompt ?? '')
  const insertTurnPreset = () => {
    if (!startRole || !endRole) return
    const t = turnPreset(startRole, endRole)
    setParam({ prompt: withTurnMotion(vp.prompt ?? '', t.motion), negativePrompt: withTurnNegative(vp.negativePrompt ?? '', t.negativeJp), autoTurn: false })
  }


  const handleGenerate = useCallback(async () => {
    const quota = await checkQuota('video')
    if (!quota.allowed) {
      upd(updateNode, id, { status: 'failed', error: `動画生成の上限（${quota.limit}本）に達しました（${quota.used}/${quota.limit}本使用済み）` })
      return
    }

    // プロンプト = つないだテキスト + @Element1（参照カットあり）+ 回転指示（始点・終点が役割カット）+ 動き。一括実行の計画と同じ規則（videoPromptOf）。日本語は生成前に英訳
    const { nodes: snapNodes, edges: snapEdges } = useCanvasStore.getState()
    const snap: WorkflowSnapshot = {
      nodes: snapNodes.map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })),
      edges: snapEdges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null })),
    }
    const thisSnap = snap.nodes!.find((n) => n.id === id)!
    const refs: TaskInputs = { start: { kind: 'photo' }, ...(supportsEndImage && connectedEndImageUrl ? { end: { kind: 'photo' } } : {}) }   // 計画と同じプロンプトの組み立て（終点があれば追従を強める）
    let translations: Record<string, string> | null = null
    if (hasList && listInfo.items.length === 0) {
      upd(updateNode, id, { status: 'failed', progress: '', error: 'つないだ List に項目がありません（スロットに動画・画像・テキストをつないでください）' })
      return
    }
    const toTranslate = textsNeedingTranslation([...videoPromptSources(snap.nodes!, snap.edges!, id, refs), ...(hasList && listInfo.mode === 'text' ? listInfo.items : [])])
    if (toTranslate.length) {
      upd(updateNode, id, { status: 'queued', progress: '日本語を英訳中...', error: null })
      try { translations = await translateTextsClient(toTranslate) }
      catch (e) {
        upd(updateNode, id, { status: 'failed', progress: '', error: `プロンプトの翻訳に失敗しました。少し待ってからもう一度お試しください（${e instanceof Error ? e.message : String(e)}）` })
        return
      }
    }
    const built = videoPromptOf(snap.nodes!, snap.edges!, thisSnap, refs, translations)
    const prompt = built.prompt
    if (!prompt && activeShots.length === 0 && !(hasList && listInfo.mode === 'text')) {
      upd(updateNode, id, { status: 'failed', progress: '', error: 'プロンプトを入力してください（Text Prompt をつなぐか、動きの欄に書いてください。マルチショットのときは各ショットの指示でも可）' })
      return
    }
    const negativePrompt = supportsNegative && built.negative ? built.negative : undefined
    const cfgScale = built.turned && currentModel?.paramStyle === 'kling' ? cfgScaleOf(nodeData as unknown as Record<string, unknown>) : undefined
    if (hasConnectedImageNode && !connectedImageUrl) {
      upd(updateNode, id, { status: 'failed', error: '参照画像をアップロードしてください' })
      return
    }

    const mode = connectedVideoUrl || listInfo.mode === 'video' ? 'video-to-video' : startImageUrl || listInfo.mode === 'image' ? 'image-to-video' : 'text-to-video'
    // リストがあれば項目の数だけ作る（Count は使わない）
    const runs = hasList ? listInfo.items.length : count
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

    for (let i = 0; i < runs; i++) {
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

    const workflowId = useWorkflowStore.getState().currentWorkflowId

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
      ...(mode === 'image-to-video' && startImageUrl ? { imageUrl: startImageUrl } : {}),
      ...(supportsEndImage && connectedEndImageUrl ? { endImageUrl: connectedEndImageUrl } : {}),
      ...(supportsElements && elementInfo.elements.length ? { elements: elementInfo.elements } : {}),
      ...(activeShots.length ? { shots: activeShots } : {}),
      ...(negativePrompt ? { negativePrompt } : {}),
      ...(cfgScale != null ? { cfgScale } : {}),
    }

    // リストの項目ごとの依頼（動画 → 参照動画・画像 → 開始フレーム・テキスト → 動きの指示に足す）
    const trItem = (t: string) => translations?.[t.trim()] ?? t
    const requestFor = (i: number): VideoGenerationRequest => {
      if (!hasList) return baseRequest
      const item = listInfo.items[i]
      if (listInfo.mode === 'video') return { ...baseRequest, mode: 'video-to-video', videoUrl: item }
      if (listInfo.mode === 'image') return { ...baseRequest, mode: 'image-to-video', imageUrl: item }
      return { ...baseRequest, prompt: [prompt, trItem(item)].filter(Boolean).join('\n') }
    }

    // count（またはリストの項目）分を並列生成
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
        const req = requestFor(i)
        const result = await falVideoProvider.generateVideo(req, onProgress, onRequestId)

        if (result.status === 'completed' && result.videoUrl) {
          upd(updateNode, displayId, {
            status: 'completed',
            progress: '',
            videoUrl: result.videoUrl,
            fileName: result.fileName ?? null,
            error: null,
          })
          const videoInputParams = {
            prompt: req.prompt,
            model: modelForMode?.id ?? nodeData.model,
            mode: req.mode,
            duration: nodeData.duration,
            resolution: nodeData.resolution,
            aspectRatio: nodeData.aspectRatio,
            ...(req.mode === 'image-to-video' ? { imageUrl: req.imageUrl ?? startImageUrl } : {}),
            ...(supportsElements && elementInfo.elements.length ? { cuts: elementInfo.elements.reduce((n, e) => n + 1 + e.referenceUrls.length, 0) } : {}),
            ...(activeShots.length ? { shots: activeShots.length } : {}),
          }
          // History とサムネイルを即座に保存（アップロード失敗やページ離脱でも確実に記録される）
          if (i === 0) useWorkflowStore.getState().updateThumbnail(workflowId!, result.videoUrl)
          const generationId = await saveGeneration({
            nodeId: id,
            nodeType: 'video-generation',
            provider: 'fal',
            model: modelForMode?.id ?? nodeData.model,
            status: 'completed',
            outputUrl: result.videoUrl,
            inputParams: videoInputParams,
          })
          // Storage アップロード後にノード・サムネ・History を Supabase 永続 URL に差し替え
          uploadVideoFromUrl(result.videoUrl, displayId).then(async (storedUrl) => {
            // L2: 自分がアップした動画をサーバー署名（表示用）、永続化は canonical
            const signedUrl = await signOwnUpload(storedUrl)
            upd(updateNode, displayId, { videoUrl: signedUrl })
            if (i === 0) useWorkflowStore.getState().updateThumbnail(workflowId!, storedUrl)
            if (generationId) updateGeneration(generationId, { output_url: storedUrl }).catch((e) => {
              console.warn('[VideoGen] updateGeneration failed:', e)
            })
            patchWorkflowNodeOutput(workflowId!, displayId, { videoUrl: storedUrl }).catch(() => {})
          }).catch(() => {
            showToast('動画の保存に失敗しました。一時URLは期限切れになる可能性があります。', 'warning')
            // アップロード失敗時は output_url を null にして History に壊れたURLが残らないようにする
            if (generationId) updateGeneration(generationId, { output_url: null }).catch((e) => {
              console.warn('[VideoGen] updateGeneration (clear) failed:', e)
            })
          })
        } else {
          const errMsg = result.error || '生成に失敗しました'
          if (isNetworkTimeout(errMsg)) {
            showToast('接続が切れました。リロードすると復元できます。', 'warning')
          } else if (isContentPolicyError(new Error(errMsg))) {
            const policyMsg = '入力内容がモデルのポリシーに違反しているため生成できませんでした'
            showToast(policyMsg, 'error')
            upd(updateNode, displayId, { status: 'failed', progress: '', error: policyMsg })
          } else {
            upd(updateNode, displayId, { status: 'failed', progress: '', error: errMsg })
            saveGeneration({
              nodeId: id,
              nodeType: 'video-generation',
              provider: 'fal',
              model: modelForMode?.id ?? nodeData.model,
              status: 'failed',
              errorMessage: errMsg,
              inputParams: { prompt, model: modelForMode?.id ?? nodeData.model, mode },
            })
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '予期しないエラー'
        if (isNetworkTimeout(errorMessage)) {
          showToast('接続が切れました。リロードすると復元できます。', 'warning')
        } else if (isContentPolicyError(error)) {
          showToast('入力内容がモデルのポリシーに違反しているため生成できませんでした', 'error')
          upd(updateNode, displayId, { status: 'failed', progress: '', error: errorMessage })
        } else {
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
      }
    }))

    const { nodes: latestNodes } = useCanvasStore.getState()
    const latestGenNode = latestNodes.find((n) => n.id === id)
    const latestData = latestGenNode?.data as unknown as VideoGenerationNodeData | undefined
    const timedOut = latestData?.status === 'queued' || latestData?.status === 'processing'
    upd(updateNode, id, {
      status: 'idle',
      progress: '',
      error: null,
      // タイムアウト時は requestId を保持してリロード後のリカバリーに備える
      ...(timedOut ? {} : { requestId: null, requestEndpoint: null, activeDisplayNodeId: null }),
    })
  }, [id, count, nodeData, currentModel, connectedImageUrl, connectedVideoUrl, connectedEndImageUrl, supportsEndImage, hasConnectedImageNode, updateNode, activeShots, elementInfo, startImageUrl, supportsElements, supportsNegative, hasList, listInfo])

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
      const recoveryWorkflowId = useWorkflowStore.getState().currentWorkflowId

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
            uploadVideoFromUrl(result.videoUrl, displayId ?? id).then(async (storedUrl) => {
              const signedUrl = await signOwnUpload(storedUrl)
              if (displayId) upd(updateNode, displayId, { videoUrl: signedUrl })
              if (recoveryWorkflowId) useWorkflowStore.getState().updateThumbnail(recoveryWorkflowId, storedUrl)
              saveGeneration({
                nodeId: id,
                nodeType: 'video-generation',
                provider: 'fal',
                model: snap?.model,
                status: 'completed',
                outputUrl: storedUrl,
              })
            }).catch(() => {
              showToast('動画の保存に失敗しました。一時URLは期限切れになる可能性があります。', 'warning')
            })
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
        <button
          className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag"
          style={{ color: 'var(--text-tertiary)' }}
          onClick={() => useCanvasStore.getState().removeNode(id)}
          title="削除"
        >
          <X size={12} />
        </button>
      </div>

      {/* 左の入力ハンドル: テキスト / 開始画像 / 終了画像（対応モデル）/ 参照カット（Kling 3.0）/ 動画。表示する数に応じて等間隔 */}
      {(() => {
        const list: Array<{ id: string; color: string; title: string }> = [
          { id: 'in-text', color: '#6366F1', title: 'プロンプト' },
          { id: 'in-image', color: '#8B5CF6', title: '開始フレーム' },
          ...(supportsEndImage ? [{ id: 'in-image-end', color: '#A78BFA', title: '終了フレーム' }] : []),
          { id: 'in-video', color: '#EC4899', title: '参照動画' },
          // 参照一式（Kling Element）: Kling v3 Pro のときだけ出す。番号がそのまま @ElementN（2026-11-02 メモ 42）
          ...(supportsElements ? VIDEO_GEN_ELEMENT_HANDLES.map((h, k) => ({ id: h, color: '#F472B6', title: `参照一式 ${k + 1}` })) : []),
          { id: 'in-list', color: '#8B5CF6', title: 'リスト（動画・画像・テキスト）' },
        ]
        const names: Record<string, string> = { 'in-text': 'プロンプト', 'in-image': '開始フレーム', 'in-image-end': '終了フレーム', 'in-video': '参照動画', 'in-element-1': '参照一式 1', 'in-element-2': '参照一式 2', 'in-element-3': '参照一式 3', 'in-list': 'リスト' }
        // 参照一式のポートは、対応していないモデルでも消さずに隠す（つないだ線が迷子にならないように）
        const hiddenTop = `${Math.round(18 + 64)}%`
        const hidden = supportsElements ? [] : VIDEO_GEN_ELEMENT_HANDLES.map((h) => <Handle key={h} id={h} type="target" position={Position.Left} style={{ top: hiddenTop, opacity: 0, pointerEvents: 'none', width: 20, height: 20 }} />)
        return [...hidden, ...list.map((h, i) => {
          const top = `${Math.round(18 + (i * 64) / (list.length - 1))}%`
          return (
            <Fragment key={h.id}>
              <Handle id={h.id} type="target" position={Position.Left} title={h.title} style={{ top, width: 20, height: 20, background: `radial-gradient(circle, ${h.color} 3px, var(--bg-surface) 3px 5px, transparent 5px)`, border: 'none', borderRadius: 0, ...dimIfNotTarget(drag, drag.inputOk(h.id)) }} />
              {/* ポート名（ノードにマウスを載せたとき・2026-11-01 メモ 7/16） */}
              <PortLabel top={top} at="input" text={names[h.id] ?? h.title} show={drag.inputOk(h.id)} />
            </Fragment>
          )
        })]
      })()}

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
        {!connectedVideoUrl && hasImageInput && connectedEndImageUrl && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
            style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#A78BFA' }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[#A78BFA]" />
            補完モード（Start → End）
          </div>
        )}
        {!connectedVideoUrl && hasImageInput && !connectedEndImageUrl && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
            style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#8B5CF6' }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
            {hasConnectedImageNode ? '参照画像あり → Image to Video' : 'リストの画像を 1 枚ずつ開始フレームに → Image to Video'}
          </div>
        )}
        {!connectedVideoUrl && hasImageInput && !endEdge && supportsEndImage && (
          <div className="text-[10px] px-1 leading-snug" style={{ color: 'var(--text-tertiary)' }}>終了フレーム: 未接続。左の 3 つ目のポート（終了フレーム）に画像をつなぐと、始点 → 終点の動画になります</div>
        )}

        {/* 役割カット（Cut Set Input の役割ポート）: 始点 → 終点 と回転指示の自動生成 */}
        {(startRole || endRole) && (
          <div className="rounded-md px-2 py-1.5 flex flex-col gap-1" style={{ background: 'rgba(244,114,182,0.08)', border: '1px solid rgba(244,114,182,0.3)' }}>
            <div className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {startRole ? CUT_ROLE_LABEL[startRole] : '開始フレーム'}{endRole ? ` → ${CUT_ROLE_LABEL[endRole]}` : ''}
              <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>（つないだ画像の向き）</span>
            </div>
            {turnMissing && (
              <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span>向きが変わるショットです</span>
                <button className="h-6 px-2 rounded text-[11px] font-medium text-white nodrag disabled:opacity-50" style={{ background: '#EC4899' }} onClick={insertTurnPreset} disabled={isGenerating} title="始点と終点の向きに合う回転の指示文を「動き」と「避けたいこと」に入れます（文は編集できます）">回転の指示文を入れる</button>
              </div>
            )}
          </div>
        )}

        {/* Kling の参照一式（2026-11-02 メモ 42）: Kling v3 Pro のときは参照一式をつなげることを明示する */}
        {supportsElements && (
          <div className="flex items-start gap-1.5 text-[10px] leading-snug rounded-md px-2 py-1.5" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Images size={11} className="mt-0.5 shrink-0" />
            <span>
              {elementInfo.connected.length === 0
                ? '参照一式: 左の「参照一式」ポートに Kling Element をつなげます（最大 3 つ）。同じ服や人物を別の角度から写した写真を渡すと、動画の途中で見える面の形や柄が崩れにくくなります。プロンプトでは @Element1 のように指します'
                : `参照一式: ${elementInfo.elements.map((e, k) => `@Element${k + 1}（正面＋別角度 ${e.referenceUrls.length}）`).join('・') || 'なし'}`}
              {elementInfo.incomplete.length > 0 && <span style={{ color: '#F59E0B' }}>{` ／ 参照一式 ${elementInfo.incomplete.join('・')} は写真が足りないため使いません（正面と別角度 1 枚以上）`}</span>}
              {elementInfo.gap && <span style={{ color: '#F59E0B' }}>{' ／ 参照一式は 1 から順につないでください'}</span>}
            </span>
          </div>
        )}
        {!supportsElements && elementInfo.connected.length > 0 && (
          <div className="text-[10px] leading-snug px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.10)', color: '#F59E0B' }}>参照一式はこのモデルでは使えません（Kling v3 Pro のみ）</div>
        )}

        {/* 動き（プロンプト）・避けたいこと（設計 §4.2）: つないだテキストの後に付く。日本語は生成時に英訳 */}
        <div>
          <label className="block text-[11px] font-medium mb-1 text-[var(--text-secondary)]">動き（プロンプト・日本語可）</label>
          <textarea
            value={vp.prompt ?? ''}
            onChange={(e) => setParam({ prompt: e.target.value })}
            rows={2}
            placeholder={turnApplies ? '回転の指示文を入れて、必要なら書き足す' : 'つないだテキストの後に付く動き（例: ゆっくり正面を向く）'}
            className="w-full rounded-md px-2 py-1 text-[11px] resize-none nodrag nowheel focus:outline-none"
            style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            onKeyDown={(e) => e.stopPropagation()}
            disabled={isGenerating}
          />
        </div>
        {supportsNegative && (
          <div>
            <label className="block text-[11px] font-medium mb-1 text-[var(--text-secondary)]">避けたいこと（ネガティブ）</label>
            <textarea
              value={vp.negativePrompt ?? ''}
              onChange={(e) => setParam({ negativePrompt: e.target.value })}
              rows={2}
              placeholder="例: 速い動き、顔の近くの手、文字、ズーム"
              className="w-full rounded-md px-2 py-1 text-[11px] resize-none nodrag nowheel focus:outline-none"
              style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              onKeyDown={(e) => e.stopPropagation()}
              disabled={isGenerating}
            />
          </div>
        )}
        <BatchMark nodeId={id} />

        {/* マルチショット（Kling 3.0 multi_prompt）: ショットごとの指示と秒数。空なら通常の 1 プロンプト */}
        {supportsShots && !connectedVideoUrl && (
          <div className="rounded-md px-2 py-1.5 flex flex-col gap-1.5" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              <Clapperboard size={11} />マルチショット
              <span className="ml-auto font-normal tabular-nums" style={{ color: shotsSeconds > TOTAL_MAX || (activeShots.length > 0 && shotsSeconds < TOTAL_MIN) ? '#F59E0B' : 'var(--text-tertiary)' }}>{activeShots.length ? `合計 ${shotsSeconds} 秒（${TOTAL_MIN}〜${TOTAL_MAX}）` : '未使用'}</span>
            </div>
            {shots.map((sh, i) => (
              <div key={i} className="flex items-start gap-1">
                <textarea
                  value={sh.prompt}
                  onChange={(e) => upd(updateNode, id, { shots: shots.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)) })}
                  placeholder={`ショット ${i + 1} の動き（例: ゆっくり正面を向く）`}
                  rows={2}
                  className="flex-1 min-w-0 rounded px-2 py-1 text-[11px] resize-none nodrag nowheel focus:outline-none"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  onKeyDown={(e) => e.stopPropagation()}
                  disabled={isGenerating}
                />
                <select
                  value={sh.duration}
                  onChange={(e) => upd(updateNode, id, { shots: shots.map((x, j) => (j === i ? { ...x, duration: Number(e.target.value) } : x)) })}
                  className="h-7 rounded px-1 text-[11px] nodrag select-compact"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  disabled={isGenerating}
                  title="このショットの秒数"
                >
                  {Array.from({ length: SHOT_MAX - SHOT_MIN + 1 }, (_, k) => SHOT_MIN + k).map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
                <button type="button" className="w-7 h-7 rounded flex items-center justify-center nodrag hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-tertiary)' }} title="このショットを削除" onClick={() => upd(updateNode, id, { shots: shots.filter((_, j) => j !== i) })} disabled={isGenerating}><Trash2 size={11} /></button>
              </div>
            ))}
            <button
              type="button"
              className="h-7 rounded text-[11px] flex items-center justify-center gap-1 nodrag hover:bg-[var(--bg-elevated)]"
              style={{ border: '1px dashed var(--border-active)', color: 'var(--text-secondary)' }}
              onClick={() => upd(updateNode, id, { shots: [...shots, { prompt: '', duration: 3 }] })}
              disabled={isGenerating}
            >
              <Plus size={10} />ショットを追加
            </button>
            {activeShots.length > 0 && (
              <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
                つないだプロンプトは共通の説明として各ショットの先頭に付きます。動画の長さはショットの合計になります（Duration の設定は使いません）。
              </div>
            )}
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
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Duration: {activeShots.length ? `${shotsSeconds}s（ショットの合計）` : `${nodeData.duration}s`}</label>
              <CapsuleFieldToggle fieldId="duration" visibility={getCapsuleVisibility('duration')} onChange={handleCapsuleChange} />
            </div>
            <select
              className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
              style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
              value={nodeData.duration}
              onChange={(e) => upd(updateNode, id, { duration: e.target.value })}
              disabled={isGenerating || activeShots.length > 0}
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

        {/* Aspect Ratio — モデルが aspect_ratio をサポートする場合のみ表示 */}
        {currentModel && currentModel.supportedAspectRatios.length > 0 && (
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
              {!currentModel.supportedAspectRatios.includes('auto') && currentModel.supportedModes.includes('image-to-video') && <option value="auto">auto（写真の比率）</option>}
              {currentModel.supportedAspectRatios.map((ar) => (
                <option key={ar} value={ar}>{ar === 'auto' ? 'auto（写真の比率）' : ar}</option>
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

        {/* Count stepper（リストをつないだら項目の数だけ作る・メモ 40） */}
        {hasList ? (
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-[var(--text-secondary)]">Count</label>
            <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.12)', color: '#8B5CF6' }} title={listInfo.mode === 'video' ? '動画ごとに参照動画として 1 本ずつ' : listInfo.mode === 'image' ? '画像ごとに開始フレームとして 1 本ずつ' : '文ごとに動きの指示として 1 本ずつ'}>List × {listInfo.items.length}（{listInfo.mode === 'video' ? '動画' : listInfo.mode === 'image' ? '画像' : listInfo.mode === 'text' ? 'テキスト' : '未設定'}）</span>
          </div>
        ) : (
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
        )}

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
