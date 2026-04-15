import { memo, useCallback, useEffect } from 'react'
import { Handle, Position, type NodeProps, type Edge } from '@xyflow/react'
import { Sparkles, Loader2, X, ChevronDown, Minus, Plus } from 'lucide-react'
import { fal } from '../../lib/ai/fal-client'
import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import type { NodeData, CapsuleFieldDef, CapsuleVisibility, ListNodeData, CameraListNodeData } from '../../types/nodes'
import { CAMERA_PRESETS } from '../../lib/cameraPresets'
import { CapsuleFieldToggle } from './CapsuleFieldToggle'
import { saveGeneration, checkQuota } from '../../lib/api/generations'
import { useWorkflowStore } from '../../stores/workflowStore'
import { getImageUrlFromNodeData } from '../../lib/utils'

function getImageUrlFromNode(node: AppNode): string | null {
  return getImageUrlFromNodeData(node.data)
}

const T2I_MODELS = [
  { value: 'fal-ai/nano-banana-2',                    label: 'Nano Banana 2' },
  { value: 'fal-ai/nano-banana-pro',                  label: 'Nano Banana Pro' },
  { value: 'fal-ai/recraft/v4/text-to-image',         label: 'Recraft V4' },
  { value: 'fal-ai/recraft/v4/pro/text-to-image',     label: 'Recraft V4 Pro' },
]

const NB_EDIT_MODELS = [
  { value: 'fal-ai/nano-banana-2',   label: 'Nano Banana 2' },
  { value: 'fal-ai/nano-banana-pro', label: 'Nano Banana Pro' },
]

const NB_RESOLUTIONS: Record<string, string[]> = {
  'fal-ai/nano-banana-2':   ['0.5K', '1K', '2K', '4K'],
  'fal-ai/nano-banana-pro': ['1K', '2K', '4K'],
}

const NB_ASPECT_RATIOS: Record<string, string[]> = {
  'fal-ai/nano-banana-2':   ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'],
  'fal-ai/nano-banana-pro': ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
}
const NB_ASPECT_RATIOS_DEFAULT = NB_ASPECT_RATIOS['fal-ai/nano-banana-2']

const RECRAFT_MODELS = new Set([
  'fal-ai/recraft/v4/text-to-image',
  'fal-ai/recraft/v4/pro/text-to-image',
])

const RECRAFT_IMAGE_SIZES = [
  { value: 'square_hd',      label: '1:1 HD' },
  { value: 'square',         label: '1:1' },
  { value: 'landscape_16_9', label: '16:9' },
  { value: 'portrait_16_9',  label: '9:16' },
  { value: 'landscape_4_3',  label: '4:3' },
  { value: 'portrait_4_3',   label: '3:4' },
] as const

// 参照画像スロット
const MAX_REF_SLOTS = 5
const REF_HANDLE_IDS = ['in-image', 'in-image-2', 'in-image-3', 'in-image-4', 'in-image-5'] as const
function refHandleId(i: number): string { return REF_HANDLE_IDS[i] ?? 'in-image' }

// ハンドルの絶対位置（ノード上端からのpx）
// ボディのバッジ行下からスロットを並べる: header(36) + padding(12) + badge(22) + gap(8) = 78px
const REF_SECTION_TOP = 78
const REF_SLOT_H = 28
const REF_SLOT_GAP = 4
function refHandleTop(i: number): number {
  return REF_SECTION_TOP + i * (REF_SLOT_H + REF_SLOT_GAP) + REF_SLOT_H / 2
}



/**
 * DisplayNode 1件分の生成処理。
 * GenNode の status は呼び出し元（handleGenerate）が管理する。
 */
async function runGeneration(
  displayNodeId: string,
  prompt: string,
  imageUrls: string[],
  params: Record<string, unknown>,
  updateNode: (id: string, data: Partial<NodeData>) => void
) {
  const model = (params.model as string) ?? 'fal-ai/nano-banana-2'
  const editModel = (params.editModel as string) ?? 'fal-ai/nano-banana-2'
  const aspectRatio = (params.aspectRatio as string) ?? '1:1'
  const resolution = (params.resolution as string) ?? '1K'
  const seed = (params.seed as string) ?? ''
  const recraftImageSize = (params.recraftImageSize as string) ?? 'square'
  const isRecraftModel = RECRAFT_MODELS.has(model)

  updateNode(displayNodeId, { status: 'generating', output: undefined, params: {} })

  try {
    let outputImageUrl: string | undefined
    let usedModel: string

    if (imageUrls.length === 0 && isRecraftModel) {
      usedModel = model
      const input: Record<string, unknown> = { prompt, image_size: recraftImageSize }
      if (seed) input.seed = Number(seed)
      const result = await fal.subscribe(model, { input, logs: false })
      outputImageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
      if (!outputImageUrl) throw new Error('生成に失敗しました')
    } else if (imageUrls.length === 0) {
      usedModel = model
      const input: Record<string, unknown> = { prompt, aspect_ratio: aspectRatio, resolution }
      if (seed) input.seed = Number(seed)
      const result = await fal.subscribe(model, { input, logs: false })
      outputImageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
      if (!outputImageUrl) throw new Error('生成に失敗しました')
    } else {
      const editEndpoint = `${editModel}/edit`
      usedModel = editEndpoint

      // モデルがサポートしない resolution / aspect_ratio は安全な値にフォールバック
      const supportedResolutions = NB_RESOLUTIONS[editModel]
      const safeResolution =
        supportedResolutions && !supportedResolutions.includes(resolution)
          ? (supportedResolutions[0] ?? '1K')
          : resolution
      const supportedAspects = NB_ASPECT_RATIOS[editModel]
      const safeAspectRatio =
        supportedAspects && aspectRatio !== 'auto' && !supportedAspects.includes(aspectRatio)
          ? '1:1'
          : aspectRatio

      const input: Record<string, unknown> = {
        prompt,
        image_urls: imageUrls,
        resolution: safeResolution,
        ...(safeAspectRatio !== 'auto' && { aspect_ratio: safeAspectRatio }),
      }
      const result = await fal.subscribe(editEndpoint, { input, logs: false })
      outputImageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
      if (!outputImageUrl) throw new Error('生成に失敗しました')
    }

    updateNode(displayNodeId, { status: 'done', output: outputImageUrl })

    saveGeneration({
      nodeId: displayNodeId,
      nodeType: 'image-generation',
      provider: 'fal',
      model: usedModel,
      status: 'completed',
      outputUrl: outputImageUrl,
      inputParams: { prompt, model: usedModel },
    })
    useWorkflowStore.getState().updateThumbnail(outputImageUrl!)
  } catch (err) {
    updateNode(displayNodeId, {
      status: 'error',
      params: { error: (err as Error).message },
    })
    saveGeneration({
      nodeId: displayNodeId,
      nodeType: 'image-generation',
      provider: 'fal',
      model,
      status: 'failed',
      errorMessage: (err as Error).message,
      inputParams: {},
    })
  }
}

function ImageGenerationNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)

  // canvasStore から直接エッジ・ノードを購読（useEdges/useNodes より確実に最新状態を反映）
  const storeNodes = useCanvasStore((s) => s.nodes)
  const storeEdges = useCanvasStore((s) => s.edges)

  const model = (nodeData.params?.model as string) ?? 'fal-ai/nano-banana-2'
  const editModel = (nodeData.params?.editModel as string) ?? 'fal-ai/nano-banana-2'
  const aspectRatio = (nodeData.params?.aspectRatio as string) ?? '1:1'
  const resolution = (nodeData.params?.resolution as string) ?? '1K'
  const recraftImageSize = (nodeData.params?.recraftImageSize as string) ?? 'square'
  const count = Math.max(1, Math.min(10, (nodeData.params?.count as number) ?? 1))
  const isRecraftModel = RECRAFT_MODELS.has(model)
  const errorMsg = nodeData.params?.error as string | undefined
  const isGenerating = nodeData.status === 'generating'

  const capsuleFields = (nodeData.capsuleFields ?? {}) as Record<string, CapsuleFieldDef>
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

  // capsuleFields に未登録のフィールドを 'visible' で初期化する
  // （未登録のままだと capsuleUtils が Object.values で列挙できずAppモードに表示されない）
  useEffect(() => {
    const defaultFields = ['model', 'editModel', 'aspectRatio', 'resolution']
    const current = (useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as NodeData | undefined)
      ?.capsuleFields as Record<string, CapsuleFieldDef> | undefined ?? {}
    const missing = defaultFields.filter((f) => !(f in current))
    if (missing.length === 0) return
    const updated = { ...current }
    missing.forEach((f) => { updated[f] = { id: f, capsuleVisibility: 'visible' } })
    updateNode(id, { capsuleFields: updated } as Partial<NodeData>)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // 画像入力エッジ（全スロット + 旧ハンドルIDの後方互換）
  const imageEdges = storeEdges.filter(
    (e) =>
      e.target === id &&
      ((REF_HANDLE_IDS as readonly string[]).includes(e.targetHandle ?? '') ||
        e.targetHandle === 'in-image-1' ||
        e.targetHandle === 'in-image-reference')
  )

  // 各スロットの接続有無を確認し、表示するスロット数を決定（常に1つ空スロットを末尾に）
  const connectedRefCount = REF_HANDLE_IDS.filter((hid, i) =>
    imageEdges.some(
      (e) =>
        e.targetHandle === hid ||
        (i === 0 && (e.targetHandle === 'in-image-1' || e.targetHandle === 'in-image-reference'))
    )
  ).length
  const refSlotCount = Math.min(connectedRefCount + 1, MAX_REF_SLOTS)

  // ListNode 専用の in-list ハンドルへの接続
  const listNodeEdge = storeEdges.find(
    (e) => e.target === id && e.targetHandle === 'in-list'
  )
  const isListMode = !!listNodeEdge
  const listNodeSrc = isListMode ? storeNodes.find((n) => n.id === listNodeEdge!.source) : null
  const listNodeMode = (listNodeSrc?.data as unknown as ListNodeData)?.mode ?? 'image'
  const listSlotCount = isListMode
    ? (() => {
        if (listNodeSrc?.type === 'cameraListNode') {
          const camData = listNodeSrc.data as unknown as CameraListNodeData
          const presetCount = (camData.selectedPresets ?? []).length
          const customCount = (camData.customAngles ?? []).filter((a) => a.trim()).length
          return Math.max(1, presetCount + customCount)
        }
        const slotCount = Math.max(1, (listNodeSrc?.data as unknown as ListNodeData)?.slotCount ?? 1)
        if (listNodeMode === 'text') {
          // テキストモード: 有効なテキストを持つスロットをカウント
          return Math.max(1, storeEdges
            .filter((e) => e.target === listNodeEdge!.source && e.targetHandle?.startsWith('in-text-'))
            .filter((e) => {
              const i = parseInt(e.targetHandle!.replace('in-text-', ''), 10)
              if (i < 0 || i >= slotCount) return false
              const src = storeNodes.find((n) => n.id === e.source)
              if (!src) return false
              const d = src.data as Record<string, unknown>
              const text = (d.outputText as string) || ((d.params as Record<string, unknown>)?.prompt as string)
              return !!text?.trim()
            }).length)
        }
        // 画像モード: 有効な画像URLを持つスロットをカウント
        return Math.max(1, storeEdges
          .filter((e) => e.target === listNodeEdge!.source && e.targetHandle?.startsWith('in-image-'))
          .filter((e) => {
            const i = parseInt(e.targetHandle!.replace('in-image-', ''), 10)
            if (i < 0 || i >= slotCount) return false
            const src = storeNodes.find((n) => n.id === e.source)
            return !!src && !!getImageUrlFromNodeData(src.data)
          }).length)
      })()
    : null

  // 画像接続あり（ListNode 画像モード含む）= Edit mode、テキストモード・なし = T2I
  const hasImages = imageEdges.length > 0 || (isListMode && listNodeMode === 'image')

  const getConnectedPrompt = useCallback((): string | null => {
    const { edges, nodes } = useCanvasStore.getState()
    const incomingEdges = edges.filter((e) => e.target === id && (e.targetHandle === 'in-text' || e.targetHandle === 'in-text-prompt'))
    if (incomingEdges.length === 0) return null
    const prompts = incomingEdges
      .map((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source)
        const d = sourceNode?.data as Record<string, unknown> | undefined
        return ((d?.params as Record<string, unknown> | undefined)?.prompt as string)
          || (d?.outputText as string)
          || null
      })
      .filter((p): p is string => !!p && p.trim() !== '')
    return prompts.length > 0 ? prompts.join('\n\n') : null
  }, [id])

  const handleGenerate = useCallback(async () => {
    const quota = await checkQuota('image')
    if (!quota.allowed) {
      updateNode(id, { status: 'error', params: { error: `画像生成の上限（${quota.limit}枚）に達しました（${quota.used}/${quota.limit}枚使用済み）` } } as never)
      return
    }

    const prompt = getConnectedPrompt()

    const { nodes: allNodes, edges: allEdges, addNode, setEdges } = useCanvasStore.getState()
    const thisNode = allNodes.find((n) => n.id === id)
    if (!thisNode) return

    // 参照画像エッジを全スロット分取得（getState 経由で最新状態）
    const inImageEdges = allEdges.filter(
      (e) =>
        e.target === id &&
        ((REF_HANDLE_IDS as readonly string[]).includes(e.targetHandle ?? '') ||
          e.targetHandle === 'in-image-1' ||
          e.targetHandle === 'in-image-reference')
    )

    // スロット順に画像URLを収集するヘルパー
    const collectFixedImages = () =>
      REF_HANDLE_IDS.flatMap((hid, i) => {
        const edge = allEdges.find(
          (e) =>
            e.target === id &&
            (e.targetHandle === hid ||
              (i === 0 &&
                (e.targetHandle === 'in-image-1' || e.targetHandle === 'in-image-reference')))
        )
        if (!edge) return []
        const n = allNodes.find((n) => n.id === edge.source)
        const url = n ? getImageUrlFromNode(n) : null
        return url ? [url] : []
      })

    // ListNode 専用ハンドルへの接続を確認
    const listEdge = allEdges.find(
      (e) => e.target === id && e.targetHandle === 'in-list'
    )

    // テキストリストモードではスロットプロンプトが主役 → グローバルプロンプト不要
    const isTextListMode = !!listEdge &&
      ((allNodes.find((n) => n.id === listEdge.source)?.data as unknown as { mode?: string })?.mode === 'text')

    if (!isTextListMode && !prompt?.trim()) {
      updateNode(id, {
        status: 'error',
        params: { ...nodeData.params, error: 'プロンプトを入力してください' },
      })
      return
    }

    let effectiveCount: number
    let perSlotImages: (string | null)[]
    let perSlotPrompts: (string | null)[]   // テキストモード時のスロットごとプロンプト
    let fixedImageUrls: string[]

    if (listEdge) {
      // LIST MODE
      const listSrc = allNodes.find((n) => n.id === listEdge.source)

      if (listSrc?.type === 'cameraListNode') {
        // CAMERA LIST MODE: 各アングルをメインプロンプトの末尾に追加
        const camData = listSrc.data as unknown as CameraListNodeData
        const presetAngles = CAMERA_PRESETS
          .filter((p) => (camData.selectedPresets ?? []).includes(p.id))
          .map((p) => p.prompt)
        const customAngles = (camData.customAngles ?? []).filter((a) => a.trim())
        const allAngles = [...presetAngles, ...customAngles]

        if (allAngles.length === 0) {
          updateNode(id, {
            status: 'error',
            params: { ...nodeData.params, error: 'カメラアングルを選択してください' },
          })
          return
        }

        effectiveCount = allAngles.length
        fixedImageUrls = collectFixedImages()
        perSlotImages = Array<string | null>(effectiveCount).fill(null)
        perSlotPrompts = allAngles.map((angle) => `${prompt ?? ''}, ${angle}`)
      } else {

      const listData = listSrc?.data as unknown as ListNodeData
      const slotCount = Math.max(1, listData?.slotCount ?? 1)
      const listMode = listData?.mode ?? 'image'

      if (listMode === 'text') {
        // TEXT LIST MODE: スロットごとのプロンプトで生成
        // テキストノードからプロンプトを取得
        const slotTexts: (string | null)[] = Array<string | null>(slotCount).fill(null)
        allEdges
          .filter((e) => e.target === listEdge.source && e.targetHandle?.startsWith('in-text-'))
          .forEach((e) => {
            const i = parseInt(e.targetHandle!.replace('in-text-', ''), 10)
            if (i >= 0 && i < slotCount) {
              const src = allNodes.find((n) => n.id === e.source)
              if (src) {
                const d = src.data as Record<string, unknown>
                slotTexts[i] = (d.outputText as string) || ((d.params as Record<string, unknown>)?.prompt as string) || null
              }
            }
          })

        // 有効テキストのあるスロットのみ（空・未接続は除外）
        const validSlots = slotTexts
          .map((text, i) => ({ text, i }))
          .filter((s): s is { text: string; i: number } => !!s.text?.trim())

        effectiveCount = Math.max(1, validSlots.length)
        perSlotImages = validSlots.map(() => null)
        perSlotPrompts = validSlots.map((s) => s.text)

        // in-image 直接接続 = 全スロット共通の参照画像（任意）
        fixedImageUrls = collectFixedImages()
      } else {
        // IMAGE LIST MODE: スロットごとの参照画像で生成（従来動作）
        const slotImages: (string | null)[] = Array<string | null>(slotCount).fill(null)
        allEdges
          .filter((e) => e.target === listEdge.source && e.targetHandle?.startsWith('in-image-'))
          .forEach((e) => {
            const i = parseInt(e.targetHandle!.replace('in-image-', ''), 10)
            if (i >= 0 && i < slotCount) {
              const src = allNodes.find((n) => n.id === e.source)
              if (src) slotImages[i] = getImageUrlFromNode(src)
            }
          })

        const validSlotImages = slotImages.filter((url): url is string => !!url)
        effectiveCount = Math.max(1, validSlotImages.length)
        perSlotImages = validSlotImages
        perSlotPrompts = Array<string | null>(effectiveCount).fill(null)

        fixedImageUrls = collectFixedImages()
      }
      } // end else (ListNode)
    } else {
      // FIXED MODE: 手動 Count を使用（従来の動作）
      effectiveCount = count
      fixedImageUrls = collectFixedImages()
      perSlotImages = Array<string | null>(effectiveCount).fill(null)
      perSlotPrompts = Array<string | null>(effectiveCount).fill(null)

      if (inImageEdges.length > 0 && fixedImageUrls.length === 0) {
        updateNode(id, {
          status: 'error',
          params: { ...nodeData.params, error: '参照画像をアップロードしてください' },
        })
        return
      }
    }

    // 既存の接続済み ImageDisplayNode の最下端 y を求めて、新規ノードの配置開始位置を決める
    const existingDisplayNodes = allEdges
      .filter((e) => e.source === id && e.sourceHandle === 'out-image-image-out')
      .map((e) => allNodes.find((n) => n.id === e.target))
      .filter((n): n is AppNode => n?.type === 'imageDisplayNode')

    const genWidth = 280
    const hGap = 40
    const vGap = 10
    const displayNodeEstimatedHeight = 360

    // 既存ノードがあれば最下端の下から、なければ GenNode の上端から開始
    const startY = existingDisplayNodes.length > 0
      ? Math.max(...existingDisplayNodes.map((n) => n.position.y)) + displayNodeEstimatedHeight + vGap
      : thisNode.position.y

    // effectiveCount 個の DisplayNode を新規作成
    const displayNodeIds: string[] = []
    const newEdges: Edge[] = []

    for (let i = 0; i < effectiveCount; i++) {
      const displayId = `node-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`
      displayNodeIds.push(displayId)

      addNode({
        id: displayId,
        type: 'imageDisplayNode',
        position: {
          x: thisNode.position.x + genWidth + hGap,
          y: startY + i * (displayNodeEstimatedHeight + vGap),
        },
        data: {
          type: 'imageDisplay' as const,
          label: 'Result',
          params: {},
          status: 'idle' as const,
          output: undefined,
        } as NodeData,
        ...(thisNode.parentId ? { parentId: thisNode.parentId } : {}),
      } as AppNode)

      newEdges.push({
        id: `e-gen-${id}-disp-${displayId}`,
        source: id,
        sourceHandle: 'out-image-image-out',
        target: displayId,
        targetHandle: 'in-image-image-in',
        style: { stroke: '#8B5CF6', strokeWidth: 2 },
        animated: false,
        className: '',
      })
    }

    const { edges: latestEdges } = useCanvasStore.getState()
    setEdges([...latestEdges, ...newEdges])

    // GenNode を generating 状態に
    updateNode(id, {
      status: 'generating',
      params: { ...nodeData.params, error: undefined },
    })

    // 全 DisplayNode を並列生成
    await Promise.all(
      displayNodeIds.map((displayId, i) => {
        const slotImg = perSlotImages[i]
        const imageUrls = slotImg ? [...fixedImageUrls, slotImg] : fixedImageUrls
        // テキストモード: スロット固有プロンプト（なければグローバルプロンプト）
        const effectivePrompt = perSlotPrompts[i] ?? prompt ?? ''
        return runGeneration(displayId, effectivePrompt, imageUrls, nodeData.params, updateNode)
      })
    )

    updateNode(id, { status: 'done' })
  }, [id, count, imageEdges, storeNodes, hasImages, nodeData.params, updateNode, getConnectedPrompt])

  useEffect(() => {
    function onCapsuleGenerate(e: Event) {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail
      if (nodeId === id) handleGenerate()
    }
    window.addEventListener('capsule:generate', onCapsuleGenerate)
    return () => window.removeEventListener('capsule:generate', onCapsuleGenerate)
  }, [id, handleGenerate])

  const hiddenHandleStyle = { opacity: 0, pointerEvents: 'none' as const }

  const isDisabled = isGenerating

  return (
    <>
      <div
        className={[
          'node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible border transition-all duration-150',
          isGenerating
            ? 'node-generating border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
            : selected
            ? 'border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
            : 'border-[var(--border)]',
        ].join(' ')}
        style={{ background: 'var(--bg-surface)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]" style={{ minHeight: 36 }}>
          <div className="w-0.5 h-4 rounded-full shrink-0" style={{ background: '#8B5CF6' }} />
          <Sparkles size={14} className="shrink-0" style={{ color: '#8B5CF6' }} />
          <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{nodeData.label}</span>
          <button
            className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag"
            style={{ color: 'var(--text-tertiary)' }}
            onClick={() => {
              const { removeNode } = useCanvasStore.getState()
              removeNode(id)
            }}
            title="削除"
          >
            <X size={12} />
          </button>
        </div>

        {/* Input handles */}
        <Handle
          id="in-text"
          type="target"
          position={Position.Left}
          style={{
            top: '18%',
            width: 20,
            height: 20,
            background: 'radial-gradient(circle, #6366F1 3px, var(--bg-surface) 3px 5px, transparent 5px)',
            border: 'none',
            borderRadius: 0,
          }}
        />
        {/* 参照画像ハンドル: スロット数に応じて動的に表示（絶対px位置） */}
        {Array.from({ length: refSlotCount }, (_, i) => (
          <Handle
            key={refHandleId(i)}
            id={refHandleId(i)}
            type="target"
            position={Position.Left}
            style={{
              position: 'absolute',
              top: refHandleTop(i),
              width: 20,
              height: 20,
              background: 'radial-gradient(circle, #8B5CF6 3px, var(--bg-surface) 3px 5px, transparent 5px)',
              border: 'none',
              borderRadius: 0,
            }}
          />
        ))}
        {/* ListNode 専用ハンドル */}
        <Handle
          id="in-list"
          type="target"
          position={Position.Left}
          style={{
            top: '85%',
            width: 20,
            height: 20,
            background: 'radial-gradient(circle, #8B5CF6 3px, var(--bg-surface) 3px 5px, transparent 5px)',
            border: 'none',
            borderRadius: 0,
          }}
        />
        {/* 後方互換: 旧ハンドルID（スロット0と同じ位置、非表示） */}
        <Handle id="in-text-prompt"     type="target" position={Position.Left} style={{ top: '18%', ...hiddenHandleStyle }} />
        <Handle id="in-image-1"         type="target" position={Position.Left} style={{ top: refHandleTop(0), ...hiddenHandleStyle }} />
        <Handle id="in-image-reference" type="target" position={Position.Left} style={{ top: refHandleTop(0), ...hiddenHandleStyle }} />

        {/* Body */}
        <div className="px-3 py-3 flex flex-col gap-2">

          {/* Handle labels + auto-mode badge */}
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'rgba(99,102,241,0.2)', color: '#6366F1' }}>Prompt ←</span>
              <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'rgba(139,92,246,0.2)', color: '#8B5CF6' }}>List ←</span>
            </div>
            <span
              className="text-[10px] rounded-full px-1.5 py-0.5 font-medium"
              style={!hasImages
                ? { background: 'rgba(99,102,241,0.15)', color: '#6366F1' }
                : { background: 'rgba(34,197,94,0.15)', color: '#22C55E' }
              }
            >
              {!hasImages ? 'T2I' : `${editModel === 'fal-ai/nano-banana-pro' ? 'NBPro' : 'NB2'} Edit`}
            </span>
          </div>

          {/* 参照画像スロット（動的） */}
          <div className="flex flex-col" style={{ gap: REF_SLOT_GAP }}>
            {Array.from({ length: refSlotCount }, (_, i) => {
              const hid = refHandleId(i)
              const edge = imageEdges.find(
                (e) =>
                  e.targetHandle === hid ||
                  (i === 0 &&
                    (e.targetHandle === 'in-image-1' || e.targetHandle === 'in-image-reference'))
              )
              const srcNode = edge ? storeNodes.find((n) => n.id === edge.source) : null
              const imgUrl = srcNode ? getImageUrlFromNodeData(srcNode.data) : null
              return (
                <div key={i} className="flex items-center gap-2" style={{ height: REF_SLOT_H }}>
                  <div
                    className="rounded overflow-hidden flex items-center justify-center shrink-0"
                    style={{
                      width: REF_SLOT_H,
                      height: REF_SLOT_H,
                      background: 'var(--bg-canvas)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {imgUrl ? (
                      <img src={imgUrl} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <span style={{ color: 'var(--border-active)', fontSize: 16 }}>·</span>
                    )}
                  </div>
                  <span className="text-[11px]" style={{ color: imgUrl ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                    参照 {i + 1}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 画像あり: Edit用モデル選択 */}
          {hasImages && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Edit Model</label>
                <CapsuleFieldToggle fieldId="editModel" visibility={getCapsuleVisibility('editModel')} onChange={handleCapsuleChange} />
              </div>
              <div className="relative">
                <select
                  className="w-full rounded-md pl-2.5 pr-8 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none transition-colors nodrag appearance-none"
                  style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
                  value={editModel}
                  onChange={(e) => {
                    const newEditModel = e.target.value
                    const currentRes = nodeData.params?.resolution as string ?? '1K'
                    const supportedRes = NB_RESOLUTIONS[newEditModel]
                    const safeRes = supportedRes && !supportedRes.includes(currentRes) ? supportedRes[0] : currentRes
                    const currentAR = nodeData.params?.aspectRatio as string ?? '1:1'
                    const supportedAR = NB_ASPECT_RATIOS[newEditModel]
                    const safeAR = supportedAR && currentAR !== 'auto' && !supportedAR.includes(currentAR) ? '1:1' : currentAR
                    updateNode(id, { params: { ...nodeData.params, editModel: newEditModel, resolution: safeRes, aspectRatio: safeAR } })
                  }}
                  disabled={isGenerating}
                >
                  {NB_EDIT_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              </div>
            </div>
          )}

          {/* 画像なし: T2Iモデル設定 */}
          {!hasImages && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Model</label>
                  <CapsuleFieldToggle fieldId="model" visibility={getCapsuleVisibility('model')} onChange={handleCapsuleChange} />
                </div>
                <div className="relative">
                  <select
                    className="w-full rounded-md pl-2.5 pr-8 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none transition-colors nodrag appearance-none"
                    style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
                    value={model}
                    onChange={(e) =>
                      updateNode(id, { params: { ...nodeData.params, model: e.target.value } })
                    }
                    disabled={isGenerating}
                  >
                    {T2I_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                </div>
              </div>
            </>
          )}

          {/* Aspect Ratio: Recraftは image_size セレクト、NB系はモデル別比率セレクト */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Aspect Ratio</label>
              <CapsuleFieldToggle fieldId="aspectRatio" visibility={getCapsuleVisibility('aspectRatio')} onChange={handleCapsuleChange} />
            </div>
            {!hasImages && isRecraftModel ? (
              <div className="relative">
                <select
                  className="w-full rounded-md pl-2.5 pr-8 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
                  style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
                  value={recraftImageSize}
                  onChange={(e) => updateNode(id, { params: { ...nodeData.params, recraftImageSize: e.target.value } })}
                  disabled={isGenerating}
                >
                  {RECRAFT_IMAGE_SIZES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              </div>
            ) : (
              <div className="relative">
                <select
                  className="w-full rounded-md pl-2.5 pr-8 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag appearance-none"
                  style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
                  value={aspectRatio}
                  onChange={(e) => updateNode(id, { params: { ...nodeData.params, aspectRatio: e.target.value } })}
                  disabled={isGenerating}
                >
                  {(NB_ASPECT_RATIOS[hasImages ? editModel : model] ?? NB_ASPECT_RATIOS_DEFAULT).map((ratio) => (
                    <option key={ratio} value={ratio}>{ratio}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              </div>
            )}
          </div>

          {/* Resolution: NB系モデルのみ */}
          {(() => {
            const activeModel = hasImages ? editModel : model
            const resolutions = NB_RESOLUTIONS[activeModel]
            if (!resolutions) return null
            return (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Resolution</label>
                  <CapsuleFieldToggle fieldId="resolution" visibility={getCapsuleVisibility('resolution')} onChange={handleCapsuleChange} />
                </div>
                <div className="flex gap-1">
                  {resolutions.map((r) => {
                    const active = resolution === r
                    return (
                      <button
                        key={r}
                        className="flex-1 py-1 rounded text-[11px] font-medium transition-colors nodrag"
                        style={{
                          background: active ? '#8B5CF6' : 'var(--bg-elevated)',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          border: `1px solid ${active ? '#8B5CF6' : 'var(--border)'}`,
                        }}
                        onClick={() => updateNode(id, { params: { ...nodeData.params, resolution: r } })}
                        disabled={isGenerating}
                      >
                        {r}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}


          {/* Error（プロンプト未入力など GenNode レベルのエラー） */}
          {nodeData.status === 'error' && errorMsg && (
            <div
              className="px-2.5 py-2 rounded-md text-[11px] text-[#EF4444]"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              {errorMsg}
            </div>
          )}

          {/* Count stepper (List Mode時はスロット数を表示) */}
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-[var(--text-secondary)]">Count</label>
            {isListMode ? (
              <span
                className="text-[11px] rounded-full px-1.5 py-0.5 font-medium"
                style={{ background: 'rgba(139,92,246,0.15)', color: '#8B5CF6' }}
              >
                List × {listSlotCount}
              </span>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  className="w-6 h-6 rounded flex items-center justify-center nodrag transition-colors"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
                  onClick={() => updateNode(id, { params: { ...nodeData.params, count: Math.max(1, count - 1) } })}
                  disabled={isGenerating}
                >
                  <Minus size={10} />
                </button>
                <span className="text-[12px] font-semibold text-[var(--text-primary)] w-6 text-center tabular-nums">{count}</span>
                <button
                  className="w-6 h-6 rounded flex items-center justify-center nodrag transition-colors"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
                  onClick={() => updateNode(id, { params: { ...nodeData.params, count: Math.min(10, count + 1) } })}
                  disabled={isGenerating}
                >
                  <Plus size={10} />
                </button>
              </div>
            )}
          </div>

          {/* Generate button */}
          <button
            className="w-full h-9 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 transition-all nodrag"
            style={{
              background: isDisabled ? 'rgba(139,92,246,0.35)' : '#8B5CF6',
              opacity: isDisabled ? 0.7 : 1,
              cursor: isDisabled ? 'not-allowed' : 'pointer',
            }}
            onClick={handleGenerate}
            disabled={isDisabled}
          >
            {isGenerating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate
              </>
            )}
          </button>
        </div>

        {/* Output handle */}
        <Handle
          id="out-image-image-out"
          type="source"
          position={Position.Right}
          style={{
            top: '50%',
            width: 20,
            height: 20,
            background: 'radial-gradient(circle, #8B5CF6 3px, var(--bg-surface) 3px 5px, transparent 5px)',
            border: 'none',
            borderRadius: 0,
          }}
        />
      </div>

    </>
  )
}

export const ImageGenerationNode = memo(function ImageGenerationNodeWrapper(props: NodeProps) {
  return (
    <div className="group">
      <ImageGenerationNodeInner {...props} />
    </div>
  )
})
