import { memo, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, type NodeProps, type Edge } from '@xyflow/react'
import { Sparkles, Loader2, Download, Maximize2, X, ChevronDown, Minus, Plus } from 'lucide-react'
import { fal } from '../../lib/ai/fal-client'
import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import type { NodeData, CapsuleFieldDef, CapsuleVisibility } from '../../types/nodes'
import { CapsuleFieldToggle } from './CapsuleFieldToggle'
import { saveGeneration } from '../../lib/api/generations'
import { useWorkflowStore } from '../../stores/workflowStore'
import { getImageUrlFromNodeData } from '../../lib/utils'

async function downloadFile(url: string, filename: string) {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank')
  }
}

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



/** ノード1件分の生成処理。バッチ・単体共用 */
async function runGeneration(
  nodeId: string,
  prompt: string,
  imageUrls: string[],
  currentParams: Record<string, unknown>,
  updateNode: (id: string, data: Partial<NodeData>) => void
) {
  const model = (currentParams.model as string) ?? 'fal-ai/nano-banana-2'
  const editModel = (currentParams.editModel as string) ?? 'fal-ai/nano-banana-2'
  const aspectRatio = (currentParams.aspectRatio as string) ?? '1:1'
  const resolution = (currentParams.resolution as string) ?? '1K'
  const seed = (currentParams.seed as string) ?? ''
  const recraftImageSize = (currentParams.recraftImageSize as string) ?? 'square'
  const isRecraftModel = RECRAFT_MODELS.has(model)

  updateNode(nodeId, {
    status: 'generating',
    output: undefined,
    params: { ...currentParams, error: undefined },
  })

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
      const input: Record<string, unknown> = {
        prompt,
        image_urls: imageUrls,
        resolution,
        ...(aspectRatio !== 'auto' && { aspect_ratio: aspectRatio }),
      }
      const result = await fal.subscribe(editEndpoint, { input, logs: false })
      outputImageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
      if (!outputImageUrl) throw new Error('生成に失敗しました')
    }

    updateNode(nodeId, { status: 'done', output: outputImageUrl })

    const { edges } = useCanvasStore.getState()
    edges
      .filter((e) => e.source === nodeId && e.sourceHandle === 'out-image-image-out')
      .forEach((e) => updateNode(e.target, { output: outputImageUrl, status: 'done' }))

    saveGeneration({
      nodeId,
      nodeType: 'image-generation',
      provider: 'fal',
      model: usedModel,
      status: 'completed',
      outputUrl: outputImageUrl,
      inputParams: { prompt, model: usedModel },
    })
    useWorkflowStore.getState().updateThumbnail(outputImageUrl!)
  } catch (err) {
    updateNode(nodeId, {
      status: 'error',
      params: { ...currentParams, error: (err as Error).message },
    })
    saveGeneration({
      nodeId,
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
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // canvasStore から直接エッジ・ノードを購読（useEdges/useNodes より確実に最新状態を反映）
  const storeNodes = useCanvasStore((s) => s.nodes)
  const storeEdges = useCanvasStore((s) => s.edges)

  const model = (nodeData.params?.model as string) ?? 'fal-ai/nano-banana-2'
  const editModel = (nodeData.params?.editModel as string) ?? 'fal-ai/nano-banana-2'
  const aspectRatio = (nodeData.params?.aspectRatio as string) ?? '1:1'
  const resolution = (nodeData.params?.resolution as string) ?? '1K'
  const seed = (nodeData.params?.seed as string) ?? ''
  const recraftImageSize = (nodeData.params?.recraftImageSize as string) ?? 'square'
  const count = Math.max(1, Math.min(10, (nodeData.params?.count as number) ?? 1))
  const isRecraftModel = RECRAFT_MODELS.has(model)
  const errorMsg = nodeData.params?.error as string | undefined
  const outputUrl = nodeData.output as string | undefined
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

  // 単一の in-image ハンドルに接続されたすべての画像エッジを接続順で取得
  // 旧ハンドルID (in-image-1, in-image-reference, in-image-2) は後方互換として含める
  const imageEdges = storeEdges.filter(
    (e) =>
      e.target === id &&
      (e.targetHandle === 'in-image' ||
        e.targetHandle === 'in-image-1' ||
        e.targetHandle === 'in-image-reference' ||
        e.targetHandle === 'in-image-2')
  )
  // 画像接続あり = NB2 Edit、なし = text-to-image
  const hasImages = imageEdges.length > 0

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
    const prompt = getConnectedPrompt()
    if (!prompt?.trim()) {
      updateNode(id, {
        status: 'error',
        params: { ...nodeData.params, error: 'プロンプトを入力してください' },
      })
      return
    }

    // 接続された画像URLを順番に収集
    const connectedImageUrls = imageEdges
      .map((e) => {
        const n = storeNodes.find((n) => n.id === e.source)
        return n ? getImageUrlFromNode(n) : null
      })
      .filter(Boolean) as string[]

    if (hasImages && connectedImageUrls.length === 0) {
      updateNode(id, {
        status: 'error',
        params: { ...nodeData.params, error: '参照画像をアップロードしてください' },
      })
      return
    }

    if (count <= 1) {
      // 単体生成（従来の挙動）
      await runGeneration(id, prompt, connectedImageUrls, nodeData.params, updateNode)
      return
    }

    // ─── バッチ生成 ───────────────────────────────────────────
    const existingBatchId = nodeData.params?.batchId as string | undefined
    const { nodes: allNodes, addNode, edges: currentEdges, setEdges } = useCanvasStore.getState()

    if (existingBatchId) {
      // 既存のバッチ仲間ノードを探す
      const siblings = allNodes.filter((n) => {
        const p = (n.data as Record<string, unknown>).params as Record<string, unknown> | undefined
        return p?.batchId === existingBatchId && n.id !== id
      })
      if (siblings.length > 0) {
        // 再生成: 全バッチノードを並列実行
        const allIds = [id, ...siblings.map((n) => n.id)]
        await Promise.all(
          allIds.map((nodeId) => {
            const node = allNodes.find((n) => n.id === nodeId)
            const params = (node?.data as Record<string, unknown>)?.params as Record<string, unknown> ?? nodeData.params
            return runGeneration(nodeId, prompt, connectedImageUrls, params, updateNode)
          })
        )
        return
      }
    }

    // 新規バッチ: count 個のノードを横並びに生成
    const batchId = crypto.randomUUID()
    const thisNode = allNodes.find((n) => n.id === id)
    if (!thisNode) return

    const nodeWidth = 280
    const gap = 10
    // count を 1 にリセット（生成後は単体モードに戻す）
    const batchParams = { ...nodeData.params, batchId, count: 1, error: undefined }

    // 現ノードに batchId を付与し count をリセット
    updateNode(id, { params: batchParams })

    // 現ノードへの接続エッジを取得（テキスト・画像どちらも複製対象）
    const incomingEdges = currentEdges.filter((e) => e.target === id)

    const nodeIds: string[] = [id]
    const newEdges: Edge[] = []

    for (let i = 1; i < count; i++) {
      const newId = `node-${Date.now()}-batch-${i}-${Math.random().toString(36).slice(2, 6)}`
      nodeIds.push(newId)
      addNode({
        id: newId,
        type: 'imageGenerationNode',
        position: {
          x: thisNode.position.x + i * (nodeWidth + gap),
          y: thisNode.position.y,
        },
        data: {
          type: 'imageGen',
          label: nodeData.label,
          params: { ...batchParams },
          status: 'idle',
          output: undefined,
          capsuleFields: nodeData.capsuleFields,
        } as NodeData,
        ...(thisNode.parentId ? { parentId: thisNode.parentId } : {}),
      } as AppNode)

      // 元ノードへの接続エッジを新ノード向けに複製
      incomingEdges.forEach((e) => {
        newEdges.push({
          ...e,
          id: `e-${e.source}-${e.sourceHandle ?? ''}-${newId}-${e.targetHandle ?? ''}`,
          target: newId,
        })
      })
    }

    // 新規エッジを一括追加
    if (newEdges.length > 0) {
      const { edges: latestEdges } = useCanvasStore.getState()
      setEdges([...latestEdges, ...newEdges])
    }

    // 全ノードを並列生成
    await Promise.all(
      nodeIds.map((nodeId) =>
        runGeneration(nodeId, prompt, connectedImageUrls, batchParams, updateNode)
      )
    )
  }, [id, count, model, editModel, aspectRatio, resolution, seed, recraftImageSize, imageEdges, storeNodes, hasImages, nodeData.params, nodeData.label, nodeData.capsuleFields, updateNode, getConnectedPrompt])

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
            top: '25%',
            width: 20,
            height: 20,
            background: 'radial-gradient(circle, #6366F1 3px, var(--bg-surface) 3px 5px, transparent 5px)',
            border: 'none',
            borderRadius: 0,
          }}
        />
        {/* 画像入力: 複数接続可能な単一ハンドル（接続順で Image1/Image2 を決定） */}
        <Handle
          id="in-image"
          type="target"
          position={Position.Left}
          style={{
            top: '65%',
            width: 20,
            height: 20,
            background: 'radial-gradient(circle, #8B5CF6 3px, var(--bg-surface) 3px 5px, transparent 5px)',
            border: 'none',
            borderRadius: 0,
          }}
        />
        {/* 旧ノードとの後方互換: BaseNode・旧カスタムレイアウト時代のハンドルID */}
        <Handle id="in-text-prompt"      type="target" position={Position.Left} style={{ top: '25%', ...hiddenHandleStyle }} />
        <Handle id="in-image-1"          type="target" position={Position.Left} style={{ top: '65%', ...hiddenHandleStyle }} />
        <Handle id="in-image-reference"  type="target" position={Position.Left} style={{ top: '65%', ...hiddenHandleStyle }} />
        <Handle id="in-image-2"          type="target" position={Position.Left} style={{ top: '65%', ...hiddenHandleStyle }} />

        {/* Body */}
        <div className="px-3 py-3 flex flex-col gap-2">

          {/* Handle labels + auto-mode badge */}
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'rgba(99,102,241,0.2)', color: '#6366F1' }}>Prompt ←</span>
              <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'rgba(139,92,246,0.2)', color: '#8B5CF6' }}>Images ←</span>
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
                  onChange={(e) =>
                    updateNode(id, { params: { ...nodeData.params, editModel: e.target.value } })
                  }
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


          {/* Error */}
          {nodeData.status === 'error' && errorMsg && (
            <div
              className="px-2.5 py-2 rounded-md text-[11px] text-[#EF4444]"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              {errorMsg}
            </div>
          )}

          {/* Output image preview */}
          {nodeData.status === 'done' && !!outputUrl && (
            <div
              className="relative rounded-lg overflow-hidden group/img cursor-pointer"
              style={{ border: '1px solid var(--border)' }}
              onClick={() => setLightboxOpen(true)}
            >
              <img src={outputUrl} alt="Generated" className="w-full h-auto block" />
              <div
                className="absolute inset-0 opacity-0 group-hover/img:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2"
                style={{ background: 'rgba(0,0,0,0.6)' }}
              >
                <button
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white nodrag"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                  onClick={(e) => { e.stopPropagation(); downloadFile(outputUrl, 'generated.png') }}
                  title="ダウンロード"
                >
                  <Download size={14} />
                </button>
                <button
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white nodrag"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                  onClick={(e) => { e.stopPropagation(); setLightboxOpen(true) }}
                  title="拡大表示"
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Count stepper */}
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-[var(--text-secondary)]">Count</label>
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

      {/* Lightbox */}
      {lightboxOpen && outputUrl && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)', zIndex: 99999 }}
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative rounded-xl overflow-hidden"
            style={{ maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={outputUrl}
              alt="Generated"
              style={{ maxWidth: '90vw', maxHeight: '90vh', display: 'block' }}
            />
            <div className="absolute top-3 right-3 flex gap-2">
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={(e) => { e.stopPropagation(); downloadFile(outputUrl, 'generated.png') }}
                title="ダウンロード"
              >
                <Download size={14} />
              </button>
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={() => setLightboxOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
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
