import { useState, useCallback, useRef } from 'react'
import { Layers, ChevronLeft, ChevronRight, Loader2, Sparkles, Film, ImageIcon, X, Download, Play, Pause } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { fal } from '../../lib/ai/fal-client'
import { buildCapsuleStages, buildCapsuleInputNodes, getActiveCapsuleGroup, type CapsuleStageInfo, type CapsuleInputInfo } from './capsuleUtils'
import type { CapsuleFieldDef } from '../../types/nodes'

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
      <div className="text-[11px] text-[#A1A1AA] mb-1 font-medium">{label}</div>
      {displayUrl ? (
        <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid #27272A' }}>
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
          style={{ border: '1px dashed #27272A', minHeight: 100 }}
        >
          {isUploading ? (
            <Loader2 size={18} className="animate-spin" style={{ color: '#8B5CF6' }} />
          ) : (
            <>
              <ImageIcon size={20} color="#3F3F46" />
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
      <div className="text-[11px] text-[#A1A1AA] mb-1 font-medium">{label}</div>
      <textarea
        className="w-full rounded-md px-3 py-2 text-[12px] text-[#FAFAFA] placeholder-[#71717A] focus:outline-none resize-y"
        style={{ background: '#0A0A0B', border: '1px solid #27272A', minHeight: 72 }}
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
    <div style={{ borderBottom: '1px solid #27272A' }}>
      <div
        className="px-4 py-2 flex items-center gap-1.5"
        style={{ borderBottom: '1px solid #1E1E22' }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#52525B' }}>
          入力
        </span>
      </div>
      <div className="px-4 pt-3 pb-1">
        {inputs.map((input) =>
          input.nodeType === 'referenceImage' ? (
            <ImageUploadField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
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
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const d = node.data as Record<string, unknown>
  const params = (d.params as Record<string, unknown>) ?? {}
  const label = field.capsuleLabel ?? field.id

  const isEditable = field.capsuleVisibility === 'editable'

  // ReferenceImageNode の imageUrl フィールドは専用UIを使う
  if (field.id === 'imageUrl' && node.type === 'referenceImageNode') {
    return <ImageUploadField nodeId={nodeId} label={label === 'imageUrl' ? '参照画像' : label} />
  }

  function updateField(value: unknown) {
    const videoFields = ['model', 'duration', 'aspectRatio', 'fps', 'audioEnabled', 'seed']
    if (videoFields.includes(field.id) && (d.type as string) === 'videoGen') {
      updateNode(nodeId, { [field.id]: value } as never)
    } else {
      updateNode(nodeId, { params: { ...params, [field.id]: value } } as never)
    }
  }

  function getValue(): string {
    const videoFields = ['model', 'duration', 'aspectRatio']
    if (videoFields.includes(field.id) && (d.type as string) === 'videoGen') {
      return String(d[field.id] ?? '')
    }
    return String(params[field.id] ?? '')
  }

  const value = getValue()

  if (!isEditable) {
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[#71717A] mb-1 font-medium">{label}</div>
        <div
          className="text-[12px] text-[#A1A1AA] px-3 py-2 rounded-md"
          style={{ background: '#0A0A0B', border: '1px solid #1E1E22' }}
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
        <div className="text-[11px] text-[#A1A1AA] mb-1 font-medium">{label}</div>
        <textarea
          className="w-full rounded-md px-3 py-2 text-[12px] text-[#FAFAFA] placeholder-[#71717A] focus:outline-none resize-y"
          style={{
            background: '#0A0A0B',
            border: '1px solid #27272A',
            minHeight: 72,
          }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        />
      </div>
    )
  }

  // duration など数値的なセレクト (VideoGenerationNode)
  if (field.id === 'duration' && (d.type as string) === 'videoGen') {
    const durations = ['3', '4', '5', '6', '8', '10']
    return (
      <div className="mb-3">
        <div className="text-[11px] text-[#A1A1AA] mb-1 font-medium">{label}</div>
        <select
          className="w-full rounded-md px-3 py-2 text-[12px] text-[#FAFAFA] focus:outline-none"
          style={{ background: '#0A0A0B', border: '1px solid #27272A' }}
          value={value}
          onChange={(e) => updateField(e.target.value)}
        >
          {durations.map((d) => (
            <option key={d} value={d}>{d}秒</option>
          ))}
        </select>
      </div>
    )
  }

  // default: テキスト入力
  return (
    <div className="mb-3">
      <div className="text-[11px] text-[#A1A1AA] mb-1 font-medium">{label}</div>
      <input
        type="text"
        className="w-full rounded-md px-3 py-2 text-[12px] text-[#FAFAFA] focus:outline-none"
        style={{ background: '#0A0A0B', border: '1px solid #27272A' }}
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

  const label = nodeType === 'videoGen' ? '動画を生成' : nodeType === 'promptEnhancer' ? 'テキストを生成' : '画像を生成'

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
          style={{ borderBottom: '1px solid #27272A' }}
        >
          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#1E1E22] transition-colors disabled:opacity-30"
            onClick={() => onPreviewChange(i - 1)}
            disabled={i === 0}
          >
            <ChevronLeft size={14} style={{ color: '#A1A1AA' }} />
          </button>

          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
              style={
                status === 'done'
                  ? { background: '#22C55E', color: '#0A0A0B' }
                  : { background: '#8B5CF6', color: 'white' }
              }
            >
              {status === 'done' ? '✓' : i + 1}
            </div>
            <span className="text-[13px] font-medium text-[#FAFAFA]">{stage.label}</span>
            <span className="text-[11px]" style={{ color: status === 'done' ? '#22C55E' : '#52525B' }}>
              {status === 'done' ? '完了' : `${i + 1} / ${stages.length}`}
            </span>
          </div>

          <button
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#1E1E22] transition-colors disabled:opacity-30"
            onClick={() => onPreviewChange(i + 1)}
            disabled={i === stages.length - 1}
          >
            <ChevronRight size={14} style={{ color: '#A1A1AA' }} />
          </button>
        </div>
      )}

      {/* ステージコンテンツ */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* グローバル入力（どのステージにも繋がっていない入力ノード） */}
        {globalInputs.map((input) =>
          input.nodeType === 'referenceImage' ? (
            <ImageUploadField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          ) : (
            <TextPromptField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
          )
        )}

        {/* このステージに繋がっている入力ノード */}
        {stage.stageInputs.map((input) =>
          input.nodeType === 'referenceImage' ? (
            <ImageUploadField key={input.nodeId} nodeId={input.nodeId} label={input.label} />
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

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
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
        muted
        playsInline
      />
      <div
        className="absolute inset-0 rounded-lg opacity-0 group-hover/vid:opacity-100 transition-opacity duration-150 flex items-end justify-end p-3 gap-2"
        style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 100%)' }}
      >
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
      <div className="flex-1 flex items-center justify-center" style={{ color: '#3F3F46' }}>
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
  const outputUrl = (d.output as string | undefined)
    || (d.videoUrl as string | undefined)
    || ((stage.nodeType as string) === 'referenceImage' ? ((d.uploadedImagePreview as string | undefined) || (d.imageUrl as string | undefined)) : undefined)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-auto">
      {isGenerating ? (
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-full border-2 border-[#27272A]"
            style={{ borderTopColor: '#8B5CF6', animation: 'spin 0.8s linear infinite' }}
          />
          <span className="text-[12px] text-[#71717A]">
            {(d.progress as string) || '生成中...'}
          </span>
        </div>
      ) : outputUrl ? (
        stage.nodeType === 'videoGen' ? (
          <VideoPreview src={outputUrl} />
        ) : (
          <ImagePreview src={outputUrl} />
        )
      ) : (
        <div className="flex flex-col items-center gap-2 text-[#3F3F46]">
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
    <div className="flex items-center gap-0 px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #1E1E22' }}>
      {stages.map((stage, i) => {
        const status = getStageStatus(stage.nodeId, nodes)
        const isActive = activeIndex === i

        return (
          <div key={stage.nodeId} className="flex items-center">
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all relative"
              style={{
                color: isActive ? '#FAFAFA' : status === 'done' ? '#71717A' : '#52525B',
                background: isActive ? '#1E1E22' : 'transparent',
              }}
              onClick={() => onChange(i)}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                style={
                  status === 'done'
                    ? { background: '#14532D', border: '1px solid #22C55E', color: '#22C55E' }
                    : isActive
                    ? { background: '#4C1D95', border: '1px solid #8B5CF6', color: '#C4B5FD' }
                    : { background: '#18181B', border: '1px solid #27272A', color: '#52525B' }
                }
              >
                {status === 'done' ? '✓' : i + 1}
              </div>
              <span className="whitespace-nowrap">{stage.label}</span>
            </button>

            {i < stages.length - 1 && (
              <div
                className="w-8 h-px mx-1 flex-shrink-0"
                style={{ background: status === 'done' ? 'rgba(34,197,94,0.3)' : '#27272A' }}
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

  const [activePreviewIndex, setActivePreviewIndex] = useState(0)

  const group = getActiveCapsuleGroup(capsuleGroupId, nodes)
  const stages = capsuleGroupId ? buildCapsuleStages(capsuleGroupId, nodes, edges) : []
  const inputs = capsuleGroupId ? buildCapsuleInputNodes(capsuleGroupId, nodes, edges, stages) : []

  const handlePreviewChange = useCallback((i: number) => {
    setActivePreviewIndex(i)
  }, [])

  if (!group) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: '#3F3F46' }}>
        <Layers size={40} style={{ opacity: 0.2 }} />
        <div className="text-center">
          <div className="text-[14px] font-medium text-[#71717A] mb-1">Appが設定されていません</div>
          <div className="text-[12px] text-[#52525B]">Canvasモードでノードをグループ化し、「App化」ボタンを押してください</div>
        </div>
      </div>
    )
  }

  if (stages.length === 0 && inputs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: '#3F3F46' }}>
        <Sparkles size={40} style={{ opacity: 0.2 }} />
        <div className="text-center">
          <div className="text-[14px] font-medium text-[#71717A] mb-1">「{group.data.label}」にノードがありません</div>
          <div className="text-[12px] text-[#52525B]">画像生成・動画生成ノードをグループに追加してください</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel */}
      <div
        className="flex flex-col flex-shrink-0 overflow-hidden"
        style={{
          width: 320,
          background: '#111113',
          borderRight: '1px solid #27272A',
        }}
      >
        {/* Panel header */}
        <div
          className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid #27272A' }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#18181B' }}
          >
            <Layers size={14} style={{ color: '#8B5CF6' }} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-[#FAFAFA]">{group.data.label}</div>
            <div className="text-[11px] text-[#71717A]">{stages.length} ステージ</div>
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
