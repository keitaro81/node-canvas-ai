import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Sparkles, LayoutGrid, Copy, Check, ChevronDown, Play, Loader2, Settings, FileOutput } from 'lucide-react'
import { X } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { PORT_COLORS } from '../../types/nodes'

type Tab = 'input' | 'output'

const MODELS = [
  { value: 'anthropic/claude-haiku-4.5',  label: 'Claude Haiku 4.5' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3-5-haiku',  label: 'Claude 3.5 Haiku' },
  { value: 'openai/gpt-5-mini',           label: 'GPT-5 Mini' },
  { value: 'openai/gpt-4o-mini',          label: 'GPT-4o Mini' },
  { value: 'openai/gpt-4o',              label: 'GPT-4o' },
  { value: 'google/gemini-2.5-flash',    label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-flash-1.5',    label: 'Gemini 1.5 Flash' },
]

const EXPORT_OPTIONS = [
  { value: 'text', label: 'テキストとしてエクスポート' },
  { value: 'copy', label: 'クリップボードにコピー' },
]

const SYSTEM_PROMPT = `You are an expert at writing detailed, evocative prompts for AI image and video generation tools. When given a prompt, enhance it to be more detailed, specific, and professionally descriptive. Add cinematography terms, lighting descriptions, mood, camera angles, color grading, and technical details where appropriate. Maintain the core intent of the original prompt. Respond only with the enhanced prompt in the same language as the input—no explanations, no preamble.`

function PromptEnhancerNodeInner({ id, data, selected }: NodeProps) {
  const updateNode = useCanvasStore((s) => s.updateNode)
  const removeNode = useCanvasStore((s) => s.removeNode)

  const nodeData = data as Record<string, unknown>
  const inputText = (nodeData.inputText as string) ?? ''
  const outputText = (nodeData.outputText as string) ?? ''
  const rawModel = (nodeData.model as string) ?? 'anthropic/claude-haiku-4.5'
  const validModelIds = MODELS.map((m) => m.value)
  const model = validModelIds.includes(rawModel) ? rawModel : 'anthropic/claude-haiku-4.5'
  const isGenerating = (nodeData.status as string) === 'generating'

  const [tab, setTab] = useState<Tab>('input')
  const [copied, setCopied] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [localInput, setLocalInput] = useState(inputText)
  const isComposing = useRef(false)
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

  const handleRun = useCallback(async () => {
    const prompt = inputText
    if (!prompt.trim()) return

    updateNode(id, { status: 'generating' } as never)

    try {
      const falKey = import.meta.env.VITE_FAL_KEY as string
      const response = await fetch('https://fal.run/fal-ai/any-llm', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, system_prompt: SYSTEM_PROMPT, prompt }),
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        console.error('[PromptEnhancer] fal.ai error:', response.status, errText)
        const err = JSON.parse(errText || '{}')
        throw new Error(err.detail ?? err.message ?? (errText || `HTTP ${response.status}`))
      }
      const json = await response.json()
      const enhanced = (json.output as string) ?? ''
      updateNode(id, { outputText: enhanced, status: 'done' } as never)
      setTab('output')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'エラーが発生しました'
      updateNode(id, { outputText: msg, status: 'error' } as never)
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
      style={{ background: 'var(--bg-surface)', width: 300 }}
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
            className="w-full resize-none rounded-md px-2.5 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none transition-colors duration-150 nodrag nopan"
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
          />
        ) : (
          <div
            className="w-full rounded-md px-2.5 py-2 text-[12px] text-[var(--text-primary)] overflow-y-auto"
            style={{
              background: 'var(--bg-canvas)',
              border: '1px solid var(--border)',
              minHeight: '180px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {isGenerating ? (
              <span className="flex items-center gap-2 text-[var(--text-tertiary)]">
                <Loader2 size={12} className="animate-spin" />
                変換中...
              </span>
            ) : outputText ? (
              outputText
            ) : (
              <span className="text-[var(--text-tertiary)]">まだ変換されていません。「▶」を押して実行してください。</span>
            )}
          </div>
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
