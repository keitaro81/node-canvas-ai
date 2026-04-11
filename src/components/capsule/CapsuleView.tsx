import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Layers, ChevronLeft, ChevronRight, Loader2, Sparkles, Film, ImageIcon, X, Download, Play, Pause, ChevronDown, Copy, Check, Volume2, VolumeX } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { fal } from '../../lib/ai/fal-client'
import { falVideoProvider } from '../../lib/ai/provider-registry'
import { buildCapsuleStages, buildCapsuleInputNodes, getActiveCapsuleGroup, type CapsuleStageInfo, type CapsuleInputInfo } from './capsuleUtils'
import type { CapsuleFieldDef } from '../../types/nodes'
import type { VideoModelDefinition } from '../../lib/ai/types'

const T2I_MODELS = [
  { value: 'fal-ai/nano-banana-2',                label: 'Nano Banana 2' },
  { value: 'fal-ai/nano-banana-pro',              label: 'Nano Banana Pro' },
  { value: 'fal-ai/recraft/v4/text-to-image',     label: 'Recraft V4' },
  { value: 'fal-ai/recraft/v4/pro/text-to-image', label: 'Recraft V4 Pro' },
]

const IMAGE_ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'] as const

const allVideoModels = falVideoProvider.getAvailableVideoModels()

const ENHANCER_MODELS = [
  { value: 'anthropic/claude-haiku-4.5',  label: 'Claude Haiku 4.5' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3-5-haiku',  label: 'Claude 3.5 Haiku' },
  { value: 'openai/gpt-5-mini',           label: 'GPT-5 Mini' },
  { value: 'openai/gpt-4o-mini',          label: 'GPT-4o Mini' },
  { value: 'openai/gpt-4o',               label: 'GPT-4o' },
  { value: 'google/gemini-2.5-flash',     label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-flash-1.5',     label: 'Gemini 1.5 Flash' },
]

const ENHANCER_SYSTEM_PROMPT = `You are an expert at writing detailed, evocative prompts for AI image and video generation tools. When given a prompt, enhance it to be more detailed, specific, and professionally descriptive. Add cinematography terms, lighting descriptions, mood, camera angles, color grading, and technical details where appropriate. Maintain the core intent of the original prompt. Respond only with the enhanced prompt in the same language as the input—no explanations, no preamble.`

// ────────────────────────────────────────────
// ステージ状態
// ────────────────────────────────────────────
type StageStatus = 'waiting' | 'active' | 'done'

function getStageStatus(nodeId: string, nodes: ReturnType<typeof useCanvasStore.getState>['nodes']): StageStatus {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return 'waiting'
  const d = node.data as Record<string, unknown>
  // ReferenceImageNode: 画像がアップ済みなら完了
  if (node.type === 'referenceImageNode') {
    return (d.imageUrl || d.uploadedImagePreview) ? 'done' : 'active'
  }
  const status = (d.status as string) ?? 'idle'
  const hasOutput = !!(d.output || d.videoUrl)
  if (status === 'done' || status === 'completed' || hasOutput) return 'done'
  return 'active'
}

// ────────────────────────────────────────────
// PromptEnhancerField（左パネル用）
// ────────────────────────────────────────────
function PromptEnhancerField({ nodeId, label }: { nodeId: string; label: string }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const updateNode = useCanvasStore((s) => s.updateNode)
  const [tab, setTab] = useState<'input' | 'output'>('input')
  const [copied, setCopied] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, openUpward: true })
  const containerRef = useRef<HTMLDivElement>(null)
  const modelBtnRef = useRef<HTMLButtonElement>(null)

  const node = nodes.find((n) => n.id === nodeId)
  const d = (node?.data ?? {}) as Record<string, unknown>
  const inputText = (d.inputText as string) ?? ''
  const outputText = (d.outputText as string) ?? ''
  const model = (d.model as string) ?? 'anthropic/claude-haiku-4.5'
  const isGenerating = (d.status as string) === 'generating'
  const selectedModel = ENHANCER_MODELS.find((m) => m.value === model) ?? ENHANCER_MODELS[0]

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setModelOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  async function handleRun() {
    if (!inputText.trim()) return
    updateNode(nodeId, { status: 'generating' } as never)
    try {
      const falKey = import.meta.env.VITE_FAL_KEY as string
      const response = await fetch('https://fal.run/fal-ai/any-llm', {
        method: 'POST',
        headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, system_prompt: ENHANCER_SYSTEM_PROMPT, prompt: inputText }),
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        const err = JSON.parse(errText || '{}')
        throw new Error(err.detail ?? err.message ?? `HTTP ${response.status}`)
      }
      const json = await response.json()
      updateNode(nodeId, { outputText: (json.output as string) ?? '', status: 'done' } as never)
      setTab('output')
    } catch (err) {
      updateNode(nodeId, { outputText: (err as Error).message, status: 'error' } as never)
      setTab('output')
    }
  }

  async function handleCopy() {
    if (!outputText) return
    await navigator.clipboard.writeText(outputText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div ref={containerRef} className="mb-4">
      {/* ヘッダー: ラベル + タブ切替 */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] text-[var(--text-secondary)] font-medium">{label}</div>
        <div
          className="flex items-center gap-0.5 rounded-md p-0.5"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
        >
          <button
            onClick={() => setTab('input')}
            className="px-2 py-0.5 rounded text-[10px] font-medium transition-all"
            style={{
              background: tab === 'input' ? 'var(--bg-elevated)' : 'transparent',
              color: tab === 'input' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            元テキスト
          </button>
          <button
            onClick={() => setTab('output')}
            className="px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1"
            style={{
              background: tab === 'output' ? 'var(--bg-elevated)' : 'transparent',
              color: tab === 'output' ? '#6366F1' : 'var(--text-tertiary)',
            }}
          >
            <Sparkles size={9} />
            AI変換後
          </button>
        </div>
      </div>

      {/* コンテンツエリア */}
      {tab === 'input' ? (
        <textarea
          className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none resize-y"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', minHeight: 80, lineHeight: 1.6 }}
          placeholder="プロンプトを入力..."
          value={inputText}
          onChange={(e) => updateNode(nodeId, { inputText: e.target.value } as never)}
        />
      ) : (
        <div
          className="w-full rounded-md px-3 py-2 text-[12px] overflow-y-auto"
          style={{
            background: 'var(--bg-canvas)',
            border: '1px solid var(--border)',
            minHeight: 80,
            lineHeight: 1.6,
            color: outputText ? 'var(--text-primary)' : 'var(--text-tertiary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {isGenerating ? (
            <span className="flex items-center gap-2 text-[var(--text-tertiary)]">
              <Loader2 size={12} className="animate-spin" />
              変換中...
            </span>
          ) : outputText || 'まだ変換されていません'}
        </div>
      )}

      {/* フッター: モデル選択 + コピー + Enhanceボタン */}
      <div className="flex items-center gap-1.5 mt-2">
        {/* モデル選択 */}
        <div className="relative">
          <button
            ref={modelBtnRef}
            className="flex items-center gap-1 h-6 px-2 rounded text-[10px] transition-colors"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            onClick={() => {
              const rect = modelBtnRef.current?.getBoundingClientRect()
              if (rect) {
                const dropdownHeight = ENHANCER_MODELS.length * 32 + 8
                const openUpward = rect.top >= dropdownHeight
                setDropdownPos({
                  top: openUpward ? rect.top - 4 : rect.bottom + 4,
                  left: rect.left,
                  openUpward,
                })
              }
              setModelOpen((v) => !v)
            }}
          >
            <span className="max-w-[90px] truncate">{selectedModel.label}</span>
            <ChevronDown size={9} />
          </button>
          {modelOpen && createPortal(
            <div
              className="rounded-lg overflow-hidden py-1"
              style={{
                position: 'fixed',
                top: dropdownPos.top,
                left: dropdownPos.left,
                transform: dropdownPos.openUpward ? 'translateY(-100%)' : 'none',
                zIndex: 99999,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                width: 170,
              }}
            >
              {ENHANCER_MODELS.map((m) => (
                <button
                  key={m.value}
                  className="w-full text-left px-3 h-8 text-[11px] transition-colors"
                  style={{ color: m.value === model ? 'var(--text-primary)' : 'var(--text-secondary)', background: m.value === model ? 'var(--bg-elevated)' : 'transparent' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = m.value === model ? 'var(--bg-elevated)' : 'transparent' }}
                  onClick={() => { updateNode(nodeId, { model: m.value } as never); setModelOpen(false) }}
                >
                  {m.label}
                </button>
              ))}
            </div>,
            document.body
          )}
        </div>

        {/* コピーボタン（出力タブのみ） */}
        {tab === 'output' && outputText && (
          <button
            className="w-6 h-6 flex items-center justify-center rounded transition-colors"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-tertiary)' }}
            onClick={handleCopy}
            title="コピー"
          >
            {copied ? <Check size={11} style={{ color: '#22C55E' }} /> : <Copy size={11} />}
          </button>
        )}

        {/* Enhanceボタン */}
        <button
          className="ml-auto flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11px] font-semibold text-white transition-all"
          style={{
            background: isGenerating ? 'rgba(99,102,241,0.25)' : '#6366F1',
            opacity: isGenerating || !inputText.trim() ? 0.5 : 1,
            cursor: isGenerating || !inputText.trim() ? 'not-allowed' : 'pointer',
          }}
          onClick={handleRun}
          disabled={isGenerating || !inputText.trim()}
        >
          {isGenerating
            ? <><Loader2 size={11} className="animate-spin" />変換中</>
            : <><Sparkles size={11} />Enhance</>
          }
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────
// フィールドレンダラー
// ────────────────────────────────────────────
function ImageUploadField({ nodeId, label }: { nodeId: string; label: string }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const updateNode = useCanvasStore((s) => s.updateNode)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const node = nodes.find((n) => n.id === nodeId)
  const d = (node?.data ?? {}) as Record<string, unknown>
  const displayUrl = (d.uploadedImagePreview as string | null) || (d.imageUrl as string | null) || null

  async function handleFile(file: File) {
    const previewUrl = URL.createObjectURL(file)
    updateNode(nodeId, { uploadedImagePreview: previewUrl } as never)
    setIsUploading(true)
    try {
      const uploadedUrl = await fal.storage.upload(file)
      updateNode(nodeId, { imageUrl: uploadedUrl, uploadedImagePreview: previewUrl } as never)
    } catch {
      updateNode(nodeId, { imageUrl: null, uploadedImagePreview: null } as never)
    } finally {
      setIsUploading(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    handleFile(file)
  }

  function handleClear() {
    updateNode(nodeId, { imageUrl: null, uploadedImagePreview: null } as never)
  }

  return (
    <div className="mb-3">
      <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
      {displayUrl ? (
        <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <img src={displayUrl} alt="Reference" className="w-full h-auto block" />
          {isUploading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <Loader2 size={20} className="animate-spin text-white" />
            </div>
          )}
          {!isUploading && (
            <button
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.65)' }}
              onClick={handleClear}
            >
              <X size={12} color="white" />
            </button>
          )}
        </div>
      ) : (
        <label
          className="flex flex-col items-center justify-center gap-2 rounded-lg py-5 cursor-pointer transition-colors"
          style={{ border: '1px dashed var(--border)', minHeight: 100 }}
        >
          {isUploading ? (
            <Loader2 size={18} className="animate-spin" style={{ color: '#8B5CF6' }} />
          ) : (
            <>
              <ImageIcon size={20} color="var(--border-active)" />
              <span className="text-[12px]" style={{ color: '#8B5CF6' }}>クリックしてアップロード</span>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleChange}
            className="hidden"
          />
        </label>
      )}
    </div>
  )
}

function TextPromptField({ nodeId, label }: { nodeId: string; label: string }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const updateNode = useCanvasStore((s) => s.updateNode)

  const node = nodes.find((n) => n.id === nodeId)
  const d = (node?.data ?? {}) as Record<string, unknown>
  const params = (d.params as Record<string, unknown>) ?? {}
  const value = String(params.prompt ?? '')

  return (
    <div className="mb-3">
      <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
      <textarea
        className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none resize-y"
        style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', minHeight: 72 }}
        placeholder="プロンプトを入力..."
        value={value}
        onChange={(e) =>
          updateNode(nodeId, { params: { ...params, prompt: e.target.value } } as never)
        }
      />
    </div>
  )
}

// ────────────────────────────────────────────
// 左パネル: 入力セクション（TextPrompt / ReferenceImage）
// ────────────────────────────────────────────
function InputsPanel({ inputs }: { inputs: CapsuleInputInfo[] }) {
  if (inputs.length === 0) return null

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        className="px-4 py-2 flex items-center gap-1.5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#52525B' }}>
          入力
        </span>
      </div>
      <div className="px-4 pt-3 pb-1">
        {inputs.map((input) =>
          input.nodeType === 'referenceImage' ? (
            <ImageUploadField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          ) : input.nodeType === 'promptEnhancer' ? (
            <PromptEnhancerField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          ) : (
            <TextPromptField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          )
        )}
      </div>
    </div>
  )
}

function FieldRenderer({ nodeId, field }: { nodeId: string; field: CapsuleFieldDef }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const updateNode = useCanvasStore((s) => s.updateNode)
  const hasImageInput = useCanvasStore((s) => {
    const n = s.nodes.find((node) => node.id === nodeId)
    if (n?.type !== 'imageGenerationNode') return false
    return s.edges.some(
      (e) => e.target === nodeId &&
        (e.targetHandle === 'in-image' || e.targetHandle === 'in-image-1' ||
         e.targetHandle === 'in-image-reference' || e.targetHandle === 'in-image-2')
    )
  })
  const hasConnectedVideo = useCanvasStore((s) => {
    const n = s.nodes.find((node) => node.id === nodeId)
    if (n?.type !== 'videoGenerationNode') return false
    return s.edges.some((e) => e.target === nodeId && e.targetHandle === 'in-video')
  })
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const d = node.data as Record<string, unknown>
  const params = (d.params as Record<string, unknown>) ?? {}
  const FIELD_LABELS: Record<string, string> = {
    model: 'Model', editModel: 'Edit Model', duration: 'Duration', aspectRatio: 'Aspect Ratio',
    resolution: 'Resolution', audioEnabled: 'Audio', seed: 'Seed',
    fps: 'FPS', prompt: 'Prompt',
  }
  const label = field.capsuleLabel ?? FIELD_LABELS[field.id] ?? field.id

  // visible と editable (後方互換) の両方を編集可能として扱う
  const isEditable = field.capsuleVisibility !== 'hidden'
  const isVideoGenNode = node.type === 'videoGenerationNode'
  const isImageGenNode = node.type === 'imageGenerationNode'

  // editModel フィールドは画像入力がある時のみ表示、model フィールドは画像入力がない時のみ表示
  if (field.id === 'editModel' && isImageGenNode && !hasImageInput) return null
  if (field.id === 'model' && isImageGenNode && hasImageInput) return null
  // seed フィールドは非表示
  if (field.id === 'seed' && isImageGenNode) return null

  // ReferenceImageNode の imageUrl フィールドは専用UIを使う
  if (field.id === 'imageUrl' && node.type === 'referenceImageNode') {
    return <ImageUploadField nodeId={nodeId} label={label === 'imageUrl' ? '参照画像' : label} />
  }

  const videoDirectFields = ['model', 'duration', 'aspectRatio', 'resolution', 'fps', 'audioEnabled', 'seed']

  function updateField(value: unknown) {
    if (videoDirectFields.includes(field.id) && isVideoGenNode) {
      updateNode(nodeId, { [field.id]: value } as never)
    } else {
      updateNode(nodeId, { params: { ...params, [field.id]: value } } as never)
    }
  }

  function getValue(): string {
    if (videoDirectFields.includes(field.id) && isVideoGenNode) {
      return String(d[field.id] ?? '')
    }
    return String(params[field.id] ?? '')
  }

  const value = getValue()

  if (!isEditable) {
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-tertiary)] mb-1 font-medium">{label}</div>
        <div
          className="text-[12px] text-[var(--text-secondary)] px-3 py-2 rounded-md"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
        >
          {value || '—'}
        </div>
      </div>
    )
  }

  // promptフィールドはテキストエリア
  if (field.id === 'prompt') {
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <textarea
          className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none resize-y"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', minHeight: 72 }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        />
      </div>
    )
  }

  // ImageGenerationNode: モデル選択
  if (field.id === 'model' && isImageGenNode) {
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <select
          className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none appearance-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        >
          {T2I_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    )
  }

  // ImageGenerationNode: アスペクト比ボタングループ
  if (field.id === 'aspectRatio' && isImageGenNode) {
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <div className="flex gap-1 flex-wrap">
          {IMAGE_ASPECT_RATIOS.map((ratio) => {
            const active = value === ratio
            return (
              <button
                key={ratio}
                className="flex-1 py-1 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: active ? '#8B5CF6' : 'var(--bg-elevated)',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: `1px solid ${active ? '#8B5CF6' : 'var(--border)'}`,
                  minWidth: 0,
                }}
                onClick={() => updateField(ratio)}
              >
                {ratio}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ImageGenerationNode: Edit Modelセレクト
  const NB_EDIT_MODELS_CAPSULE = [
    { value: 'fal-ai/nano-banana-2',   label: 'Nano Banana 2' },
    { value: 'fal-ai/nano-banana-pro', label: 'Nano Banana Pro' },
  ]
  if (field.id === 'editModel' && isImageGenNode) {
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <select
          className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none appearance-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        >
          {NB_EDIT_MODELS_CAPSULE.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    )
  }

  // ImageGenerationNode: Resolution ボタングループ
  const NB_RESOLUTIONS_CAPSULE: Record<string, string[]> = {
    'fal-ai/nano-banana-2':   ['0.5K', '1K', '2K', '4K'],
    'fal-ai/nano-banana-pro': ['1K', '2K', '4K'],
  }
  if (field.id === 'resolution' && isImageGenNode) {
    const activeModel = (params.editModel as string) || (params.model as string) || ''
    const resolutions = NB_RESOLUTIONS_CAPSULE[activeModel] ?? ['1K', '2K', '4K']
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <div className="flex gap-1">
          {resolutions.map((r) => {
            const active = (value || '1K') === r
            return (
              <button
                key={r}
                className="flex-1 py-1 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: active ? '#8B5CF6' : 'var(--bg-elevated)',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: `1px solid ${active ? '#8B5CF6' : 'var(--border)'}`,
                }}
                onClick={() => updateField(r)}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // VideoGenerationNode: モデル選択
  if (field.id === 'model' && isVideoGenNode) {
    const availableVideoModels = hasConnectedVideo
      ? allVideoModels.filter((m) => m.supportedModes.includes('video-to-video'))
      : allVideoModels.filter((m) => !m.supportedModes.every((mode) => mode === 'video-to-video'))
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <select
          className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none appearance-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        >
          {availableVideoModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name} (${m.pricePerSecond}/s)</option>
          ))}
        </select>
      </div>
    )
  }

  // VideoGenerationNode: アスペクト比ボタングループ
  if (field.id === 'aspectRatio' && isVideoGenNode) {
    const currentVideoModel = allVideoModels.find((m) => m.id === String(d.model ?? ''))
    const edges = useCanvasStore.getState().edges
    const hasConnectedImage = edges.some((e) => e.target === nodeId && e.targetHandle === 'in-image')
    const ratios = (
      hasConnectedImage && (currentVideoModel as VideoModelDefinition | undefined)?.i2vSupportedAspectRatios
        ? (currentVideoModel as VideoModelDefinition).i2vSupportedAspectRatios!
        : currentVideoModel?.supportedAspectRatios ?? ['16:9', '9:16', '1:1']
    ) as string[]
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <div className="flex gap-1.5 flex-wrap">
          {ratios.map((ar) => {
            const active = value === ar
            return (
              <button
                key={ar}
                className="flex-1 py-1.5 rounded text-[11px] font-medium transition-colors"
                style={{
                  background: active ? 'rgba(236,72,153,0.2)' : 'var(--bg-elevated)',
                  color: active ? '#EC4899' : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'rgba(236,72,153,0.5)' : 'var(--border)'}`,
                  minWidth: '3rem',
                }}
                onClick={() => updateField(ar)}
              >
                {ar}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // VideoGenerationNode: duration セレクト
  if (field.id === 'duration' && isVideoGenNode) {
    const currentVideoModel = allVideoModels.find((m) => m.id === String(d.model ?? ''))
    const durations = currentVideoModel?.supportedDurations ?? ['5', '10']
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <select
          className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        >
          {durations.map((dur) => (
            <option key={dur} value={dur}>{dur}秒</option>
          ))}
        </select>
      </div>
    )
  }

  // VideoGenerationNode: resolution セレクト
  if (field.id === 'resolution' && isVideoGenNode) {
    const currentVideoModel = allVideoModels.find((m) => m.id === String(d.model ?? ''))
    const resolutions = currentVideoModel?.supportedResolutions ?? []
    if (resolutions.length <= 1) return null
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
        <select
          className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        >
          {resolutions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
    )
  }

  // VideoGenerationNode: audioEnabled トグル
  if (field.id === 'audioEnabled' && isVideoGenNode) {
    const currentVideoModel = allVideoModels.find((m) => m.id === String(d.model ?? ''))
    if (!currentVideoModel?.features.includes('audio')) return null
    const enabled = d.audioEnabled === true || d.audioEnabled === 'true'
    return (
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] text-[var(--text-secondary)] font-medium">{label}</div>
        <button
          className="relative w-8 h-4 rounded-full transition-colors"
          style={{ background: enabled ? '#EC4899' : 'var(--border-active)' }}
          onClick={() => updateField(!enabled)}
        >
          <div
            className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
            style={{ left: enabled ? '18px' : '2px' }}
          />
        </button>
      </div>
    )
  }

  // default: テキスト入力
  return (
    <div className="mb-3">
      <div className="text-[11px] text-[var(--text-secondary)] mb-1 font-medium">{label}</div>
      <input
        type="text"
        className="w-full rounded-md px-3 py-2 text-[12px] text-[var(--text-primary)] focus:outline-none"
        style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
        value={value}
        onChange={(e) => updateField(e.target.value)}
      />
    </div>
  )
}

// ────────────────────────────────────────────
// 生成ボタン + プレビュー（ステージごとの小プレビュー）
// ────────────────────────────────────────────
function StageGenerateButton({
  nodeId,
  nodeType,
  stageIndex,
  stages,
}: {
  nodeId: string
  nodeType: CapsuleStageInfo['nodeType']
  stageIndex: number
  stages: CapsuleStageInfo[]
}) {
  const nodes = useCanvasStore((s) => s.nodes)
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null
  if ((nodeType as string) === 'referenceImage') return null
  const d = node.data as Record<string, unknown>

  const isGenerating =
    d.status === 'generating' || d.status === 'queued' || d.status === 'processing'

  // 前のステージが完了しているか（ステージ0は常にOK）
  const prevStage = stageIndex > 0 ? stages[stageIndex - 1] : null
  const prevDone = prevStage ? getStageStatus(prevStage.nodeId, nodes) === 'done' : true
  const isLocked = !prevDone

  const label = nodeType === 'videoGen' ? '動画を生成' : '画像を生成'

  function handleClick() {
    const event = new CustomEvent('capsule:generate', { detail: { nodeId } })
    window.dispatchEvent(event)
  }

  const isDisabled = isGenerating || isLocked

  return (
    <div>
      <button
        className="w-full h-9 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 transition-all"
        style={{
          background: isDisabled ? 'rgba(139,92,246,0.25)' : '#8B5CF6',
          opacity: isDisabled ? 0.5 : 1,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
        }}
        onClick={handleClick}
        disabled={isDisabled}
      >
        {isGenerating ? (
          <><Loader2 size={14} className="animate-spin" />生成中...</>
        ) : nodeType === 'videoGen' ? (
          <><Film size={14} />{label}</>
        ) : (
          <><Sparkles size={14} />{label}</>
        )}
      </button>
      {isLocked && (
        <p className="text-center text-[11px] mt-1.5" style={{ color: '#52525B' }}>
          ステージ {stageIndex} の完了後に実行できます
        </p>
      )}
    </div>
  )
}

// ────────────────────────────────────────────
// 左パネル: 現在のステージの入力・操作
// ────────────────────────────────────────────
function CapsuleStagePanel({
  stages,
  globalInputs,
  activePreviewIndex,
  onPreviewChange,
}: {
  stages: CapsuleStageInfo[]
  globalInputs: CapsuleInputInfo[]
  activePreviewIndex: number
  onPreviewChange: (i: number) => void
}) {
  const nodes = useCanvasStore((s) => s.nodes)
  const i = activePreviewIndex
  const stage = stages[i]
  if (!stage) return null
  const status = getStageStatus(stage.nodeId, nodes)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ステージナビゲーション（複数ステージの場合のみ） */}
      {stages.length > 1 && (
        <div
          className="flex items-center justify-between px-4 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30"
            onClick={() => onPreviewChange(i - 1)}
            disabled={i === 0}
          >
            <ChevronLeft size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>

          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
              style={
                status === 'done'
                  ? { background: '#22C55E', color: 'var(--bg-canvas)' }
                  : { background: '#8B5CF6', color: 'white' }
              }
            >
              {status === 'done' ? '✓' : i + 1}
            </div>
            <span className="text-[13px] font-medium text-[var(--text-primary)]">{stage.label}</span>
            <span className="text-[11px]" style={{ color: status === 'done' ? '#22C55E' : '#52525B' }}>
              {status === 'done' ? '完了' : `${i + 1} / ${stages.length}`}
            </span>
          </div>

          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30"
            onClick={() => onPreviewChange(i + 1)}
            disabled={i === stages.length - 1}
          >
            <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      )}

      {/* ステージコンテンツ */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* グローバル入力（どのステージにも繋がっていない入力ノード） */}
        {globalInputs.map((input) =>
          input.nodeType === 'referenceImage' ? (
            <ImageUploadField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          ) : input.nodeType === 'promptEnhancer' ? (
            <PromptEnhancerField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          ) : (
            <TextPromptField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          )
        )}

        {/* このステージに繋がっている入力ノード */}
        {stage.stageInputs.map((input) =>
          input.nodeType === 'referenceImage' ? (
            <ImageUploadField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          ) : input.nodeType === 'promptEnhancer' ? (
            <PromptEnhancerField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          ) : (
            <TextPromptField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          )
        )}

        {/* フィールド（モデル・アスペクト比など） */}
        {stage.fields.map((field) => (
          <FieldRenderer key={field.id} nodeId={stage.nodeId} field={field} />
        ))}

        <StageGenerateButton nodeId={stage.nodeId} nodeType={stage.nodeType} stageIndex={i} stages={stages} />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────
// プレビュー: 画像・動画
// ────────────────────────────────────────────
async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    a.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank')
  }
}

function ImagePreview({ src }: { src: string }) {
  return (
    <div className="relative group/img max-w-full max-h-full">
      <img src={src} alt="Generated" className="max-w-full max-h-full rounded-lg block" style={{ objectFit: 'contain' }} />
      <div
        className="absolute inset-0 rounded-lg opacity-0 group-hover/img:opacity-100 transition-opacity duration-150 flex items-end justify-end p-3"
        style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 100%)' }}
      >
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white transition-colors"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => downloadFile(src, 'generated.png')}
          title="ダウンロード"
        >
          <Download size={16} />
        </button>
      </div>
    </div>
  )
}

function VideoPreview({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(false)

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  return (
    <div className="relative group/vid max-w-full max-h-full">
      <video
        ref={videoRef}
        src={src}
        className="max-w-full max-h-full rounded-lg block"
        style={{ objectFit: 'contain' }}
        autoPlay
        loop
        playsInline
      />
      <div
        className="absolute inset-0 rounded-lg opacity-0 group-hover/vid:opacity-100 transition-opacity duration-150 flex items-end justify-end p-3 gap-2"
        style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 100%)' }}
      >
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white transition-colors"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={toggleMute}
          title={muted ? '音声オン' : '音声オフ'}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white transition-colors"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={togglePlay}
          title={playing ? '一時停止' : '再生'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white transition-colors"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => downloadFile(src, 'generated.mp4')}
          title="ダウンロード"
        >
          <Download size={16} />
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────
// 右エリア: 大プレビュー
// ────────────────────────────────────────────
function LargePreview({ stages, activeIndex }: { stages: CapsuleStageInfo[]; activeIndex: number }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const stage = stages[activeIndex]
  if (!stage) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--border-active)' }}>
        <div className="text-center">
          <div className="text-4xl mb-3 opacity-20">🎨</div>
          <div className="text-[12px]">ステージを選択してください</div>
        </div>
      </div>
    )
  }

  const node = nodes.find((n) => n.id === stage.nodeId)
  const d = (node?.data ?? {}) as Record<string, unknown>
  const status = (d.status as string) ?? 'idle'
  const isGenerating = status === 'generating' || status === 'queued' || status === 'processing'

  // 出力URLをノードタイプ別に解決
  // videoGen は d.videoUrl を使う（d.output には上流 imageGen の画像URLが伝播している場合があるため）
  // imageGen は d.output を使う
  const outputUrl = stage.nodeType === 'videoGen'
    ? ((d.videoUrl as string | null | undefined) || undefined)
    : ((d.output as string | undefined) || undefined)

  const outputText = undefined

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-auto">
      {isGenerating ? (
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-full border-2 border-[var(--border)]"
            style={{ borderTopColor: '#8B5CF6', animation: 'spin 0.8s linear infinite' }}
          />
          <span className="text-[12px] text-[var(--text-tertiary)]">
            {(d.progress as string) || '生成中...'}
          </span>
        </div>
      ) : outputUrl ? (
        stage.nodeType === 'videoGen' ? (
          <VideoPreview src={outputUrl} />
        ) : (
          <ImagePreview src={outputUrl} />
        )
      ) : outputText ? (
        <div
          className="w-full max-w-lg rounded-xl p-5 text-[13px] leading-relaxed whitespace-pre-wrap"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        >
          {outputText}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-[var(--border-active)]">
          <div className="text-4xl opacity-30">
            {stage.nodeType === 'videoGen' ? '🎬' : '🖼'}
          </div>
          <div className="text-[12px]">まだ生成されていません</div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────
// Step タブ（上部）
// ────────────────────────────────────────────
function StepTabs({
  stages,
  activeIndex,
  onChange,
}: {
  stages: CapsuleStageInfo[]
  activeIndex: number
  onChange: (i: number) => void
}) {
  const nodes = useCanvasStore((s) => s.nodes)

  return (
    <div className="flex items-center gap-0 px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
      {stages.map((stage, i) => {
        const status = getStageStatus(stage.nodeId, nodes)
        const isActive = activeIndex === i

        return (
          <div key={stage.nodeId} className="flex items-center">
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all relative"
              style={{
                color: isActive ? 'var(--text-primary)' : status === 'done' ? 'var(--text-tertiary)' : '#52525B',
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
              }}
              onClick={() => onChange(i)}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                style={
                  status === 'done'
                    ? { background: '#22C55E', color: 'white' }
                    : isActive
                    ? { background: '#4C1D95', border: '1px solid #8B5CF6', color: '#C4B5FD' }
                    : { background: 'var(--bg-panel)', border: '1px solid var(--border)', color: '#52525B' }
                }
              >
                {status === 'done' ? '✓' : i + 1}
              </div>
              <span className="whitespace-nowrap">{stage.label}</span>
            </button>

            {i < stages.length - 1 && (
              <div
                className="w-8 h-px mx-1 flex-shrink-0"
                style={{ background: status === 'done' ? 'rgba(34,197,94,0.3)' : 'var(--border)' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────
// メイン CapsuleView
// ────────────────────────────────────────────
export function CapsuleView() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const capsuleGroupId = useCanvasStore((s) => s.capsuleGroupId)
  const isOwned = useWorkflowStore((s) => s.currentWorkflowIsOwned)

  const [activePreviewIndex, setActivePreviewIndex] = useState(0)

  const group = getActiveCapsuleGroup(capsuleGroupId, nodes)
  const stages = capsuleGroupId ? buildCapsuleStages(capsuleGroupId, nodes, edges) : []
  const inputs = capsuleGroupId ? buildCapsuleInputNodes(capsuleGroupId, nodes, edges, stages) : []

  const handlePreviewChange = useCallback((i: number) => {
    setActivePreviewIndex(i)
  }, [])

  if (!group) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: 'var(--border-active)' }}>
        <Layers size={40} style={{ opacity: 0.2 }} />
        <div className="text-center">
          <div className="text-[14px] font-medium text-[var(--text-tertiary)] mb-1">Appが設定されていません</div>
          <div className="text-[12px] text-[#52525B]">Canvasモードでノードをグループ化し、「App」ボタンを押してください。</div>
        </div>
      </div>
    )
  }

  if (stages.length === 0 && inputs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: 'var(--border-active)' }}>
        <Sparkles size={40} style={{ opacity: 0.2 }} />
        <div className="text-center">
          <div className="text-[14px] font-medium text-[var(--text-tertiary)] mb-1">「{group.data.label}」にノードがありません</div>
          <div className="text-[12px] text-[#52525B]">画像生成・動画生成ノードをグループに追加してください</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden" style={{ position: 'relative' }}>
      {/* Read-only overlay — 他人のワークフローは操作不可 */}
      {!isOwned && (
        <div
          className="absolute inset-0 z-50"
          style={{ cursor: 'not-allowed', background: 'transparent' }}
        />
      )}
      {/* Left panel */}
      <div
        className="flex flex-col flex-shrink-0 overflow-hidden"
        style={{
          width: 320,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Panel header */}
        <div
          className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--bg-panel)' }}
          >
            <Layers size={14} style={{ color: '#8B5CF6' }} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-[var(--text-primary)]">{group.data.label}</div>
            <div className="text-[11px] text-[var(--text-tertiary)]">{stages.length} ステージ</div>
          </div>
        </div>

        {stages.length > 0 ? (
          <CapsuleStagePanel
            stages={stages}
            globalInputs={inputs}
            activePreviewIndex={activePreviewIndex}
            onPreviewChange={handlePreviewChange}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <InputsPanel inputs={inputs} />
          </div>
        )}
      </div>

      {/* Right: preview area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <StepTabs stages={stages} activeIndex={activePreviewIndex} onChange={handlePreviewChange} />
        <LargePreview stages={stages} activeIndex={activePreviewIndex} />
      </div>
    </div>
  )
}
