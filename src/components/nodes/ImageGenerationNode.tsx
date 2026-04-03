import { memo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Sparkles, Loader2, Download, Maximize2, X, ChevronDown } from 'lucide-react'
import { fal } from '../../lib/ai/fal-client'
import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import type { NodeData } from '../../types/nodes'
import { getDefaultProvider } from '../../lib/ai/provider-registry'
import { saveGeneration } from '../../lib/api/generations'
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

const FLUX_MODELS = [
  { value: 'black-forest-labs/flux-schnell',  label: 'FLUX Schnell' },
  { value: 'black-forest-labs/flux-dev',      label: 'FLUX Dev' },
  { value: 'black-forest-labs/flux-1.1-pro',  label: 'FLUX 1.1 Pro' },
  { value: 'fal-ai/flux-2',                   label: 'FLUX.2' },
  { value: 'fal-ai/nano-banana-2',             label: 'Nano Banana 2' },
]


const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const


function ImageGenerationNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // canvasStore から直接エッジ・ノードを購読（useEdges/useNodes より確実に最新状態を反映）
  const storeNodes = useCanvasStore((s) => s.nodes)
  const storeEdges = useCanvasStore((s) => s.edges)

  const model = (nodeData.params?.model as string) ?? 'black-forest-labs/flux-schnell'
  const aspectRatio = (nodeData.params?.aspectRatio as string) ?? '1:1'
  const seed = (nodeData.params?.seed as string) ?? ''
  const errorMsg = nodeData.params?.error as string | undefined
  const outputUrl = nodeData.output as string | undefined
  const isGenerating = nodeData.status === 'generating'

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
    // 'in-text-prompt' は旧ノード（BaseNode時代）との後方互換ハンドルID
    const incomingEdge = edges.find((e) => e.target === id && (e.targetHandle === 'in-text' || e.targetHandle === 'in-text-prompt'))
    if (!incomingEdge) return null
    const sourceNode = nodes.find((n) => n.id === incomingEdge.source)
    const d = sourceNode?.data as Record<string, unknown> | undefined
    return (d?.params as Record<string, unknown> | undefined)?.prompt as string
      || d?.outputText as string
      || null
  }, [id])

  const handleGenerate = useCallback(async () => {
    const prompt = getConnectedPrompt()
    if (!prompt?.trim()) {
      updateNode(id, {
        status: 'error',
        params: { ...nodeData.params, error: 'TextPromptノードを接続してプロンプトを入力してください' },
      })
      return
    }

    updateNode(id, {
      status: 'generating',
      output: undefined,
      params: { ...nodeData.params, error: undefined },
    })

    // 接続された画像URLを順番に収集
    const connectedImageUrls = imageEdges
      .map((e) => {
        const n = storeNodes.find((n) => n.id === e.source)
        return n ? getImageUrlFromNode(n) : null
      })
      .filter(Boolean) as string[]

    try {
      let outputImageUrl: string | undefined
      let usedModel: string

      if (connectedImageUrls.length === 0 && model === 'fal-ai/nano-banana-2') {
        // Nano Banana 2 T2I（Edge Functionを経由せず直接呼び出し）
        usedModel = model
        const nb2Input: Record<string, unknown> = { prompt, aspect_ratio: aspectRatio }
        if (seed) nb2Input.seed = Number(seed)
        const result = await fal.subscribe('fal-ai/nano-banana-2', {
          input: nb2Input,
          logs: false,
        })
        outputImageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
        if (!outputImageUrl) throw new Error('生成に失敗しました')
      } else if (connectedImageUrls.length === 0) {
        // FLUX系 text-to-image（Edge Function経由）
        usedModel = model
        const provider = getDefaultProvider()
        const result = await provider.generateImage({
          prompt,
          aspectRatio: aspectRatio as '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
          model,
          seed: seed ? Number(seed) : undefined,
        })
        if (result.status === 'completed' && result.outputUrl) {
          outputImageUrl = result.outputUrl
        } else {
          throw new Error(result.error ?? '生成に失敗しました')
        }
      } else {
        // 画像あり → Nano Banana 2 Edit
        usedModel = 'fal-ai/nano-banana-2/edit'
        const nb2EditInput: Record<string, unknown> = {
          prompt,
          image_urls: connectedImageUrls,
          aspect_ratio: aspectRatio,
        }
        const result = await fal.subscribe('fal-ai/nano-banana-2/edit', {
          input: nb2EditInput,
          logs: false,
        })
        outputImageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
        if (!outputImageUrl) throw new Error('生成に失敗しました')
      }

      updateNode(id, { status: 'done', output: outputImageUrl })
      const { edges: currentEdges } = useCanvasStore.getState()
      currentEdges
        .filter((e) => e.source === id && e.sourceHandle === 'out-image-image-out')
        .forEach((e) => updateNode(e.target, { output: outputImageUrl, status: 'done' }))

      saveGeneration({
        nodeId: id,
        nodeType: 'image-generation',
        provider: 'fal',
        model: usedModel,
        status: 'completed',
        outputUrl: outputImageUrl,
        inputParams: { prompt, model: usedModel },
      })
    } catch (err) {
      updateNode(id, {
        status: 'error',
        params: { ...nodeData.params, error: (err as Error).message },
      })
      saveGeneration({
        nodeId: id,
        nodeType: 'image-generation',
        provider: 'fal',
        model,
        status: 'failed',
        errorMessage: (err as Error).message,
        inputParams: {},
      })
    }
  }, [id, model, aspectRatio, seed, imageEdges, storeNodes, nodeData.params, updateNode, getConnectedPrompt])

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
            : 'border-[#27272A]',
        ].join(' ')}
        style={{ background: '#111113' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[#27272A]" style={{ minHeight: 36 }}>
          <div className="w-0.5 h-4 rounded-full shrink-0" style={{ background: '#8B5CF6' }} />
          <Sparkles size={14} className="shrink-0" style={{ color: '#8B5CF6' }} />
          <span className="flex-1 text-[13px] font-semibold text-[#FAFAFA] truncate">{nodeData.label}</span>
          <button
            className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag"
            style={{ color: '#71717A' }}
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
            background: 'radial-gradient(circle, #6366F1 3px, #111113 3px 5px, transparent 5px)',
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
            background: 'radial-gradient(circle, #8B5CF6 3px, #111113 3px 5px, transparent 5px)',
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
              {!hasImages ? 'T2I' : 'NB2 Edit'}
            </span>
          </div>

          {/* 画像なし: T2Iモデル設定（画像あり時は自動でNB2 Edit） */}
          {!hasImages && (
            <>
              <div>
                <label className="block text-[11px] font-medium text-[#A1A1AA] mb-1">Model</label>
                <div className="relative">
                  <select
                    className="w-full rounded-md pl-2.5 pr-8 py-1.5 text-[12px] text-[#FAFAFA] focus:outline-none transition-colors nodrag appearance-none"
                    style={{ background: '#0A0A0B', border: '1px solid #27272A' }}
                    value={model}
                    onChange={(e) =>
                      updateNode(id, { params: { ...nodeData.params, model: e.target.value } })
                    }
                    disabled={isGenerating}
                  >
                    {FLUX_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                </div>
              </div>
            </>
          )}

          {/* Aspect Ratio: T2I・Editモード共通 */}
          <div>
            <label className="block text-[11px] font-medium text-[#A1A1AA] mb-1">Aspect Ratio</label>
            <div className="flex gap-1">
              {ASPECT_RATIOS.map((ratio) => {
                const active = aspectRatio === ratio
                return (
                  <button
                    key={ratio}
                    className="flex-1 py-1 rounded text-[11px] font-medium transition-colors nodrag"
                    style={{
                      background: active ? '#8B5CF6' : '#1E1E22',
                      color: active ? '#FAFAFA' : '#A1A1AA',
                      border: `1px solid ${active ? '#8B5CF6' : '#27272A'}`,
                    }}
                    onClick={() =>
                      updateNode(id, { params: { ...nodeData.params, aspectRatio: ratio } })
                    }
                    disabled={isGenerating}
                  >
                    {ratio}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Seed: T2Iモードのみ */}
          {!hasImages && (
            <div>
              <label className="block text-[11px] font-medium text-[#A1A1AA] mb-1">Seed</label>
              <input
                type="number"
                className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[#FAFAFA] placeholder-[#71717A] focus:outline-none transition-colors nodrag"
                style={{ background: '#0A0A0B', border: '1px solid #27272A' }}
                placeholder="空欄 = ランダム"
                value={seed}
                onChange={(e) =>
                  updateNode(id, { params: { ...nodeData.params, seed: e.target.value } })
                }
                disabled={isGenerating}
              />
            </div>
          )}

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
              style={{ border: '1px solid #27272A' }}
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
            background: 'radial-gradient(circle, #8B5CF6 3px, #111113 3px 5px, transparent 5px)',
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
