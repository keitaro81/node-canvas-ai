// 生成 App の「ショット → 結合」（2026-11-02 メモ 54・ユーザー決定）: Video Generation を並べて Video Merge でまとめる形の App。
// 左 = 写真と文の欄（ショットの設定はキャンバスのまま出さない）＋「動画を作る」。押すと全ショットを同時に作り、そろったら自動で結合する。
// 右 = 結合した動画＋ショットの一覧（ショットごとに作り直し → 結合し直す）。ショットと結合はキャンバスのノードがそのまま動く
// （capsule:generate / capsule:merge / capsule:export のイベント）。形の判定と状態は lib/apps/mergeApp.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Download, Film, ImageIcon, Layers, Loader2, RotateCcw, X } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore, selectCanEditNow } from '../../stores/workflowStore'
import { useBatchStore } from '../../stores/batchStore'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useSignedMedia } from '../../hooks/useSignedMedia'
import { MediaPickerDialog, type PickedMedia } from '../library/MediaPickerDialog'
import { signLibraryUrl } from '../../lib/api/library'
import { downloadFile } from '../../lib/downloadFile'
import { effectiveVideoSettings, videoPricePerSecond } from '../../lib/ai/videoModels'
import { videoGenInputOf } from '../../lib/video/videoGenInput'
import { latestVideoOf, videoResultsOf } from '../../lib/video/latestVideo'
import { mergeAppInputsOf, missingImageInputs, shotStateOf, shotTurnLabel, type MergeAppInput, type MergeAppShape, type ShotState } from '../../lib/apps/mergeApp'

const ACCENT = '#EC4899'

/** 写真の欄（2 列のマス）。選ぶとノードの画像を置き換える（今の生成 App と同じくワークフローに入る） */
function PhotoSlot({ input, disabled }: { input: MergeAppInput; disabled: boolean }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === input.nodeId))
  const updateNode = useCanvasStore((s) => s.updateNode)
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const d = (node?.data ?? {}) as Record<string, unknown>
  const raw = (d.uploadedImagePreview as string | null | undefined) || (d.imageUrl as string | null | undefined) || null
  const { url, onError } = useSignedMedia(raw, workflowId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const title = input.hint ? `${input.hint}の写真` : input.label
  const pick = async (items: PickedMedia[]) => {
    const p = items[0]
    if (!p) return
    setBusy(true)
    try { updateNode(input.nodeId, { imageUrl: await signLibraryUrl(p.url), uploadedImagePreview: null } as never) }
    finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
        className="relative w-full rounded-lg overflow-hidden flex items-center justify-center disabled:cursor-not-allowed"
        style={{ aspectRatio: '3 / 4', border: raw ? '1px solid var(--border)' : '1px dashed var(--border-active)', background: 'var(--bg-canvas)' }}
        title="クリックで写真を選ぶ（アップロード / ライブラリ）"
      >
        {busy ? <Loader2 size={16} className="animate-spin" style={{ color: ACCENT }} />
          : url ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} onError={onError} />
          : <span className="flex flex-col items-center gap-1 text-[11px]" style={{ color: ACCENT }}><ImageIcon size={18} />クリックして追加</span>}
      </button>
      <div className="flex items-center gap-1 min-w-0">
        <span className="flex-1 text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={title}>{title}</span>
        {raw && !disabled && (
          <button type="button" className="w-5 h-5 shrink-0 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-tertiary)' }} title="写真を外す" onClick={() => updateNode(input.nodeId, { imageUrl: null, uploadedImagePreview: null } as never)}>
            <X size={11} />
          </button>
        )}
      </div>
      <MediaPickerDialog open={open} onClose={() => setOpen(false)} media="image" source="capsule" onPick={(items) => { void pick(items) }} />
    </div>
  )
}

/** 文の欄（Text Prompt の文をそのまま書き換える） */
function TextSlot({ input, disabled }: { input: MergeAppInput; disabled: boolean }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === input.nodeId))
  const updateNode = useCanvasStore((s) => s.updateNode)
  const params = ((node?.data as unknown as { params?: Record<string, unknown> } | undefined)?.params) ?? {}
  return (
    <div>
      <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{input.label}</div>
      <textarea
        className="w-full rounded-md px-3 py-2 text-[12px] focus:outline-none resize-y disabled:opacity-60"
        style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)', minHeight: 72 }}
        value={String(params.prompt ?? '')}
        disabled={disabled}
        onChange={(e) => updateNode(input.nodeId, { params: { ...params, prompt: e.target.value } } as never)}
      />
    </div>
  )
}

function SignedVideo({ raw, className, controls = true }: { raw: string | null; className?: string; controls?: boolean }) {
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const { url, onError } = useSignedMedia(raw, workflowId)
  if (!url) return null
  return <video src={url} className={className} controls={controls} muted playsInline loop preload="metadata" onError={onError} />
}

const STATUS_TEXT: Record<ShotState['status'], string> = { idle: 'まだ作っていません', running: '作成中…', done: '完了', failed: '失敗' }

export function MergeAppView({ groupId, groupLabel, shape }: { groupId: string; groupLabel: string; shape: MergeAppShape }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const updateNode = useCanvasStore((s) => s.updateNode)
  const canEdit = useWorkflowStore(selectCanEditNow)
  const showCost = useBatchStore((s) => s.showCost)
  const isMobile = useIsMobile()

  const inputs = useMemo(() => mergeAppInputsOf(groupId, nodes, edges, shape), [groupId, nodes, edges, shape])
  const missing = useMemo(() => missingImageInputs(inputs, nodes), [inputs, nodes])

  // 本数・秒数・費用の目安（ショットの設定はキャンバスのまま。Count が 2 以上なら本数分）。モデル・長さはノードと同じ「実際に使う設定」、
  // 単価は解像度・音声の有無も見る（2026-11-02 メモ 63）
  const summary = useMemo(() => {
    let videos = 0, seconds = 0, usd = 0
    for (const id of shape.shotIds) {
      const d = (nodes.find((n) => n.id === id)?.data ?? {}) as Record<string, unknown>
      const eff = effectiveVideoSettings(d, videoGenInputOf(id, nodes, edges))
      const runs = Math.max(1, Math.min(10, Number(d.count) || 1))
      const sec = Number(eff.duration) || 0
      const price = eff.model ? videoPricePerSecond(eff.model, { resolution: eff.resolution, audioEnabled: d.audioEnabled }) : 0
      videos += runs; seconds += sec * runs; usd += sec * runs * price
    }
    return { videos, seconds, usd }
  }, [shape, nodes, edges])

  // 今回の実行（作り始める前にあった Video Result の id をショットごとに覚え、それより後の結果で進みを見る）
  const [run, setRun] = useState<{ id: number; since: Record<string, string[]> } | null>(null)
  const handledRun = useRef<number | null>(null)
  const runStates = useMemo(() => (run ? Object.fromEntries(Object.entries(run.since).map(([id, before]) => [id, shotStateOf(id, nodes, edges, new Set(before))])) : null), [run, nodes, edges])
  const runRunning = !!runStates && Object.values(runStates).some((s) => s.status === 'running')
  const runFailed = !!runStates && !runRunning && Object.values(runStates).some((s) => s.status === 'failed')
  const merge = (nodes.find((n) => n.id === shape.mergeId)?.data ?? {}) as Record<string, unknown>
  const merging = merge.status === 'generating'
  const mergedRaw = typeof merge.videoUrl === 'string' && merge.videoUrl ? merge.videoUrl : null
  const mergeError = merge.status === 'error' && typeof merge.error === 'string' ? merge.error : null
  const busy = runRunning || merging
  const shotStates = shape.shotIds.map((id) => (run?.since[id] && runStates ? runStates[id] : shotStateOf(id, nodes, edges)))
  const allShotsReady = shape.shotIds.every((id) => !!latestVideoOf(id, nodes, edges))

  // 全ショットがそろったら自動で結合（失敗したショットがあれば結合しない。作り直していないショットは最後の動画を使う）
  useEffect(() => {
    if (!run || runRunning || handledRun.current === run.id) return
    handledRun.current = run.id
    if (runFailed) return
    const { nodes: ns, edges: es } = useCanvasStore.getState()
    if (!shape.shotIds.every((id) => !!latestVideoOf(id, ns, es))) return
    window.dispatchEvent(new CustomEvent('capsule:merge', { detail: { nodeId: shape.mergeId } }))
  }, [run, runRunning, runFailed, shape])

  const start = (ids: string[]) => {
    if (busy || !canEdit) return
    const { nodes: ns, edges: es } = useCanvasStore.getState()
    const since: Record<string, string[]> = {}
    for (const id of ids) {
      since[id] = videoResultsOf(id, ns, es).map((n) => n.id)
      updateNode(id, { status: 'idle', error: null } as never)   // 前回の失敗の表示を消してから
    }
    setRun({ id: Date.now(), since })
    for (const id of ids) window.dispatchEvent(new CustomEvent('capsule:generate', { detail: { nodeId: id } }))
  }
  const remerge = () => { if (!busy && canEdit && allShotsReady) window.dispatchEvent(new CustomEvent('capsule:merge', { detail: { nodeId: shape.mergeId } })) }
  const download = () => {
    if (!mergedRaw) return
    if (shape.exportId) window.dispatchEvent(new CustomEvent('capsule:export', { detail: { nodeId: shape.exportId } }))
    else void downloadFile(mergedRaw, `${groupLabel || 'video'}.mp4`)
  }

  const doneCount = shotStates.filter((s) => s.status === 'done').length
  const progressText = runRunning ? `ショット ${doneCount} / ${shape.shotIds.length} 完了・そろったら結合します`
    : merging ? '結合しています…'
    : runFailed ? '失敗したショットがあります。下の一覧で作り直すと、結合し直します'
    : null

  const left = (
    <div className="flex flex-col min-h-0" style={{ width: isMobile ? '100%' : 320, background: 'var(--bg-surface)', borderRight: isMobile ? undefined : '1px solid var(--border)' }}>
      <div className="flex items-center gap-2.5 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--bg-panel)' }}><Layers size={14} style={{ color: ACCENT }} /></div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{groupLabel}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>動画 {shape.shotIds.length} ショット → 結合</div>
        </div>
      </div>
      <div className={`${isMobile ? '' : 'flex-1 overflow-y-auto'} px-4 py-3 flex flex-col gap-3`}>
        {inputs.some((i) => i.kind === 'image') && (
          <div className="grid grid-cols-2 gap-2">
            {inputs.filter((i) => i.kind === 'image').map((i) => <PhotoSlot key={i.nodeId} input={i} disabled={!canEdit || busy} />)}
          </div>
        )}
        {inputs.filter((i) => i.kind === 'text').map((i) => <TextSlot key={i.nodeId} input={i} disabled={!canEdit || busy} />)}
        {inputs.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>この App で入れる写真や文はありません（キャンバスのとおりに作ります）</div>}
      </div>
      <div className="px-4 py-3 shrink-0 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--border)' }}>
        {missing.length > 0 && (
          <div className="text-[11px] leading-snug" style={{ color: '#F59E0B' }}>{missing.map((i) => (i.hint ? `${i.hint}の写真` : i.label)).join('・')}を入れてください</div>
        )}
        <button
          type="button"
          className="w-full h-10 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: ACCENT }}
          disabled={busy || !canEdit || missing.length > 0}
          onClick={() => start(shape.shotIds)}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
          {busy ? '作成中…' : '動画を作る'}
        </button>
        <div className="text-[11px] text-center" style={{ color: 'var(--text-tertiary)' }}>
          動画 {summary.videos} 本（計 {summary.seconds} 秒）を同時に作り、そろったら結合します{showCost && summary.usd > 0 ? `・目安 $${summary.usd.toFixed(2)}` : ''}
        </div>
      </div>
    </div>
  )

  const right = (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-5 shrink-0" style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>結果</h2>
        {progressText && <span className="text-[12px] truncate" style={{ color: runFailed ? '#F59E0B' : 'var(--text-secondary)' }}>{progressText}</span>}
        <div className="flex-1" />
        {allShotsReady && !busy && canEdit && (
          <button type="button" onClick={remerge} className="h-8 px-3 rounded-lg text-[12px] flex items-center gap-1.5 hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} title="いまのショットの動画で結合し直す">
            <RotateCcw size={13} />結合し直す
          </button>
        )}
        {mergedRaw && !busy && (
          <button type="button" onClick={download} className="h-8 px-3 rounded-lg text-[12px] font-medium text-white flex items-center gap-1.5" style={{ background: ACCENT }} title={shape.exportId ? 'Export の名前の付け方でダウンロード' : '結合した動画をダウンロード'}>
            <Download size={13} />ダウンロード
          </button>
        )}
      </div>
      <div className={`${isMobile ? '' : 'flex-1 overflow-y-auto'} p-5 flex flex-col gap-4`} style={{ background: 'var(--bg-canvas)' }}>
        {/* 結合した動画（縦長・横長どちらでも収まるよう、高さを決めて中に収める） */}
        <div className="relative w-full max-w-[880px] mx-auto rounded-xl overflow-hidden flex items-center justify-center shrink-0" style={{ background: '#000', height: 'min(56vh, 520px)' }}>
          {merging ? <span className="flex items-center gap-2 text-[13px]" style={{ color: '#fff' }}><Loader2 size={16} className="animate-spin" />結合しています…</span>
            : mergedRaw ? <SignedVideo raw={mergedRaw} className="absolute inset-0 w-full h-full object-contain" />
            : <span className="text-[12px] px-6 text-center" style={{ color: 'rgba(255,255,255,0.6)' }}>{runRunning ? 'ショットを作っています。そろったら結合した動画がここに出ます' : '写真を入れて「動画を作る」を押すと、結合した動画がここに出ます'}</span>}
        </div>
        {mergeError && !merging && (
          <div className="w-full max-w-[880px] mx-auto flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
            <AlertCircle size={14} className="shrink-0" />結合に失敗しました: {mergeError}
          </div>
        )}
        {/* ショットの一覧（ショットごとに作り直せる） */}
        <div className="w-full max-w-[880px] mx-auto">
          <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>ショット</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${isMobile ? 2 : Math.min(4, shape.shotIds.length)}, minmax(0, 1fr))` }}>
            {shape.shotIds.map((id, i) => {
              const st = shotStates[i]
              const turn = shotTurnLabel(id, nodes, edges)
              return (
                <div key={id} className="rounded-lg overflow-hidden flex flex-col" style={{ border: `1px solid ${st.status === 'failed' ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, background: 'var(--bg-surface)' }}>
                  <div className="relative w-full overflow-hidden flex items-center justify-center" style={{ height: 200, background: '#000' }}>
                    {st.status === 'running' ? <Loader2 size={16} className="animate-spin" style={{ color: '#fff' }} />
                      : st.videoUrl ? <SignedVideo raw={st.videoUrl} className="absolute inset-0 w-full h-full object-contain" />
                      : <Film size={16} style={{ color: 'rgba(255,255,255,0.4)' }} />}
                  </div>
                  <div className="px-2 py-1.5 flex flex-col gap-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[12px] font-medium shrink-0" style={{ color: 'var(--text-primary)' }}>ショット {i + 1}</span>
                      {turn && <span className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{turn}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="flex-1 text-[11px] truncate" style={{ color: st.status === 'failed' ? '#EF4444' : st.status === 'done' ? '#22C55E' : 'var(--text-tertiary)' }} title={st.error ?? undefined}>
                        {STATUS_TEXT[st.status]}{st.error ? `: ${st.error}` : ''}
                      </span>
                      {canEdit && (
                        <button type="button" disabled={busy || missing.length > 0} onClick={() => start([id])} className="shrink-0 h-6 px-2 rounded text-[11px] flex items-center gap-1 hover:bg-[var(--bg-elevated)] disabled:opacity-40 disabled:cursor-not-allowed" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} title={st.status === 'idle' ? 'このショットだけ作る（ほかのショットがそろっていれば結合する）' : 'このショットだけ作り直して、結合し直す'}>
                          <RotateCcw size={11} />{st.status === 'idle' ? '作る' : '作り直す'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className={`flex-1 min-h-0 flex ${isMobile ? 'flex-col overflow-y-auto' : 'overflow-hidden'}`} style={{ position: 'relative' }}>
      {/* 他人のワークフロー（編集できない）は操作不可（今の生成 App と同じ） */}
      {!canEdit && <div className="absolute inset-0 z-50" style={{ cursor: 'not-allowed', background: 'transparent' }} />}
      {left}
      {right}
    </div>
  )
}
