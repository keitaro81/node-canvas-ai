import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Sparkles, LayoutGrid, Copy, Check, ChevronDown, Play, Loader2, Settings, FileOutput } from 'lucide-react'
import { X } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { fal } from '../../lib/ai/fal-client'
import { PORT_COLORS } from '../../types/nodes'

type Tab = 'input' | 'output'

const MODELS = [
  { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'anthropic/claude-opus-4-6',   label: 'Claude Opus 4.6' },
]

const EXPORT_OPTIONS = [
  { value: 'text', label: 'テキストとしてエクスポート' },
  { value: 'copy', label: 'クリップボードにコピー' },
]

const SYSTEM_PROMPT = `You are an expert at writing detailed, evocative prompts for AI image and video generation tools. When given a prompt, enhance it to be more detailed, specific, and professionally descriptive. Add cinematography terms, lighting descriptions, mood, camera angles, color grading, and technical details where appropriate. Maintain the core intent of the original prompt. Respond only with the enhanced prompt in the same language as the input—no explanations, no preamble.`

const SYSTEM_PROMPT_FREE_ANGLE = `You are an expert at writing detailed, evocative prompts for AI image and video generation tools. When given a prompt, enhance it to be more detailed, specific, and professionally descriptive. Add lighting descriptions, mood, color grading, and technical details where appropriate. Do NOT add any instructions about camera angles or poses — these will be controlled separately. Maintain the core intent of the original prompt. Respond only with the enhanced prompt in the same language as the input—no explanations, no preamble.`

function PromptEnhancerNodeInner({ id, data, selected }: NodeProps) {
  const updateNode = useCanvasStore((s) => s.updateNode)
  const removeNode = useCanvasStore((s) => s.removeNode)

  const nodeData = data as Record<string, unknown>
  const inputText = (nodeData.inputText as string) ?? ''
  const outputText = (nodeData.outputText as string) ?? ''
  const rawModel = (nodeData.model as string) ?? 'anthropic/claude-sonnet-4-6'
  const validModelIds = MODELS.map((m) => m.value)
  const model = validModelIds.includes(rawModel) ? rawModel : MODELS[0].value
  const isGenerating = (nodeData.status as string) === 'generating'

  const [tab, setTab] = useState<Tab>('input')
  const [copied, setCopied] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [localInput, setLocalInput] = useState(inputText)
  const [localOutput, setLocalOutput] = useState(outputText)
  const isComposing = useRef(false)
  const isOutputComposing = useRef(false)
  const nodeRef = useRef<HTMLDivElement>(null)

  // 外部クリックでドロップダウンを閉じる
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (nodeRef.current && !nodeRef.current.contains(e.target as Node)) {
        setModelOpen(false)
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  // 外部からの変更（接続ノード等）をローカル状態に同期
  useEffect(() => {
    if (!isComposing.current) setLocalInput(inputText)
  }, [inputText])

  useEffect(() => {
    if (!isOutputComposing.current) setLocalOutput(outputText)
  }, [outputText])

  const handleRun = useCallback(async () => {
    const prompt = inputText
    if (!prompt.trim()) return

    // 出力先 ImageGen に CameraListNode が接続されているか確認
    const { edges, nodes: allNodes } = useCanvasStore.getState()
    const downstreamImageGenIds = edges
      .filter((e) => e.source === id && e.sourceHandle === 'out-text-enhanced')
      .map((e) => e.target)
    const hasCameraList = downstreamImageGenIds.some((genId) =>
      edges.some((e) => e.target === genId && e.targetHandle === 'in-list' &&
        allNodes.find((n) => n.id === e.source && n.type === 'cameraListNode'))
    )
    const systemPrompt = hasCameraList ? SYSTEM_PROMPT_FREE_ANGLE : SYSTEM_PROMPT

    updateNode(id, { status: 'generating' } as never)

    try {
      type LLMOutput = { output?: string }
      const result = await fal.subscribe('fal-ai/any-llm', {
        input: { model, system_prompt: systemPrompt, prompt },
        logs: false,
      })
      const data = (result as unknown as { data?: LLMOutput }).data
      const enhanced = data?.output ?? ''
      updateNode(id, { outputText: enhanced, status: 'done' } as never)
      setLocalOutput(enhanced)
      setTab('output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'エラーが発生しました'
      updateNode(id, { outputText: msg, status: 'error' } as never)
      setLocalOutput(msg)
      setTab('output')
    }
  }, [id, model, inputText, updateNode])

  const handleCopy = useCallback(async () => {
    if (!outputText) return
    await navigator.clipboard.writeText(outputText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [outputText])

  const handleExport = useCallback((option: string) => {
    setExportOpen(false)
    if (option === 'copy') {
      handleCopy()
      return
    }
    if (option === 'text' && outputText) {
      const blob = new Blob([outputText], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'enhanced-prompt.txt'
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [outputText, handleCopy])

  const selectedModel = MODELS.find((m) => m.value === model) ?? MODELS[0]
  const accentColor = '#6366F1'

  return (
    <div
      ref={nodeRef}
      className={[
        'node-popin group relative flex flex-col rounded-xl overflow-visible',
        'border transition-all duration-150',
        selected
          ? 'border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
          : 'border-[var(--border)]',
        isGenerating ? 'node-generating' : '',
      ].join(' ')}
      style={{ background: 'var(--bg-surface)', width: 280 }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]"
        style={{ minHeight: 36 }}
      >
        <Sparkles size={14} style={{ color: accentColor }} className="flex-shrink-0" />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">
          {(nodeData.label as string) ?? 'アシスタント'}
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 w-[22px] h-[22px] flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all duration-150"
          onClick={() => removeNode(id)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={12} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-0">
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150"
          style={{
            background: tab === 'input' ? 'var(--bg-elevated)' : 'transparent',
            color: tab === 'input' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            border: tab === 'input' ? '1px solid var(--border-active)' : '1px solid transparent',
          }}
          onClick={() => setTab('input')}
          title="入力"
        >
          <LayoutGrid size={13} />
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150"
          style={{
            background: tab === 'output' ? 'var(--bg-elevated)' : 'transparent',
            color: tab === 'output' ? accentColor : 'var(--text-tertiary)',
            border: tab === 'output' ? `1px solid ${accentColor}44` : '1px solid transparent',
          }}
          onClick={() => setTab('output')}
          title="AI変換結果"
        >
          <Sparkles size={13} />
        </button>

        {/* Output tab actions */}
        {tab === 'output' && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
              onClick={handleCopy}
              title="コピー"
            >
              {copied ? <Check size={13} style={{ color: '#22C55E' }} /> : <Copy size={13} />}
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
              onClick={() => updateNode(id, { outputText, status: 'done' } as never)}
              title="出力をテキストノードに送る"
            >
              <LayoutGrid size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-3 pt-2 pb-2 nodrag">
        {tab === 'input' ? (
          <textarea
            className="node-textarea resize-y w-full rounded-md px-2.5 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none transition-colors duration-150 nodrag nopan"
            style={{
              background: 'var(--bg-canvas)',
              border: '1px solid var(--border)',
              minHeight: '180px',
              lineHeight: 1.6,
            }}
            placeholder="プロンプトを入力..."
            value={localInput}
            onChange={(e) => {
              setLocalInput(e.target.value)
              if (!isComposing.current) {
                updateNode(id, { inputText: e.target.value } as never)
              }
            }}
            onCompositionStart={() => { isComposing.current = true }}
            onCompositionEnd={(e) => {
              isComposing.current = false
              updateNode(id, { inputText: (e.target as HTMLTextAreaElement).value } as never)
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          />
        ) : isGenerating ? (
          <div
            className="node-textarea w-full rounded-md px-2.5 py-2 text-[12px]"
            style={{
              background: 'var(--bg-canvas)',
              border: '1px solid var(--border)',
              minHeight: '180px',
              lineHeight: 1.6,
            }}
          >
            <span className="flex items-center gap-2 text-[var(--text-tertiary)]">
              <Loader2 size={12} className="animate-spin" />
              変換中...
            </span>
          </div>
        ) : (
          <textarea
            className="node-textarea resize-y w-full rounded-md px-2.5 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none transition-colors duration-150 nodrag nopan"
            style={{
              background: 'var(--bg-canvas)',
              border: '1px solid var(--border)',
              minHeight: '180px',
              lineHeight: 1.6,
            }}
            placeholder="まだ変換されていません。「▶」を押して実行してください。"
            value={localOutput}
            onChange={(e) => {
              setLocalOutput(e.target.value)
              if (!isOutputComposing.current) {
                updateNode(id, { outputText: e.target.value } as never)
              }
            }}
            onCompositionStart={() => { isOutputComposing.current = true }}
            onCompositionEnd={(e) => {
              isOutputComposing.current = false
              updateNode(id, { outputText: (e.target as HTMLTextAreaElement).value } as never)
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1.5 px-3 pb-3 nodrag">
        {/* Model selector */}
        <div className="relative">
          <button
            className="flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-canvas)' }}
            onClick={() => { setModelOpen((v) => !v); setExportOpen(false) }}
          >
            <span className="truncate max-w-[90px]">{selectedModel.label}</span>
            <ChevronDown size={10} className="text-[var(--text-tertiary)] flex-shrink-0" />
          </button>
          {modelOpen && (
            <div
              className="absolute bottom-8 left-0 z-50 rounded-lg overflow-hidden py-1"
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                minWidth: 160,
              }}
            >
              {MODELS.map((m) => (
                <button
                  key={m.value}
                  className="w-full text-left px-3 h-8 text-[11px] transition-colors duration-150"
                  style={{
                    color: m.value === model ? 'var(--text-primary)' : 'var(--text-secondary)',
                    background: m.value === model ? 'var(--bg-elevated)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = m.value === model ? 'var(--bg-elevated)' : 'transparent' }}
                  onClick={() => {
                    updateNode(id, { model: m.value } as never)
                    setModelOpen(false)
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
          style={{ border: '1px solid var(--border)', background: 'var(--bg-canvas)' }}
          title="設定"
        >
          <Settings size={12} />
        </button>

        {/* Export */}
        <div className="relative">
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-canvas)' }}
            onClick={() => { setExportOpen((v) => !v); setModelOpen(false) }}
            title="エクスポート"
          >
            <FileOutput size={12} />
          </button>
          {exportOpen && (
            <div
              className="absolute bottom-8 left-0 z-50 rounded-lg overflow-hidden py-1"
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                minWidth: 180,
              }}
            >
              {EXPORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className="w-full text-left px-3 h-8 text-[11px] text-[var(--text-secondary)] transition-colors duration-150"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
                  onClick={() => handleExport(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Run button */}
        <button
          className="ml-auto w-8 h-8 flex items-center justify-center rounded-full transition-all duration-150"
          style={{
            background: isGenerating ? 'var(--border-active)' : 'var(--text-primary)',
            color: isGenerating ? 'var(--text-tertiary)' : 'var(--bg-canvas)',
            flexShrink: 0,
          }}
          onClick={handleRun}
          disabled={isGenerating}
          title="AI変換を実行"
        >
          {isGenerating
            ? <Loader2 size={14} className="animate-spin" />
            : <Play size={14} style={{ marginLeft: 2 }} />
          }
        </button>
      </div>

      {/* Output handle */}
      <Handle
        id="out-text-enhanced"
        type="source"
        position={Position.Right}
        style={{
          top: '50%',
          width: 20,
          height: 20,
          background: `radial-gradient(circle, ${PORT_COLORS.text} 3px, var(--bg-surface) 3px 5px, transparent 5px)`,
          border: 'none',
          borderRadius: 0,
        }}
      />
    </div>
  )
}

export const PromptEnhancerNode = memo(function PromptEnhancerNodeWrapper(props: NodeProps) {
  return <PromptEnhancerNodeInner {...props} />
})
