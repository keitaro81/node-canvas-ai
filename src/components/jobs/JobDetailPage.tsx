import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, CircleNotch } from '@phosphor-icons/react'
import { useBatchStore } from '../../stores/batchStore'
import { useAuthStore } from '../../stores/authStore'
import { fetchJobDetail, fetchJobItems, fetchJobTasks, fetchJobThumbs, reviewItem, setJobLayoutOverrides, subscribeJobItems } from '../../lib/api/batchJobs'
import { batchRerun, submitJobFully } from '../../lib/api/batch'
import { signBatchPath } from '../../lib/cutout/store'
import { jobProgress } from '../../lib/batch/jobsQuery'
import { formatJst } from '../../lib/batch/dates'
import { formatCost } from '../../lib/batch/cost'
import { downloadBlob } from '../../lib/export/zip'
import type { CutoutParams, ExportParams } from '../../types/nodes'
import type { BatchItemRow, BatchJobDetail, BatchOutputRow, BatchReview, BatchTaskRow } from '../../types/batch'
import { useReviewStore, type ReviewContext } from '../../lib/review/reviewStore'
import { CUTOUT_VARIANT_KEY, cutoutNodesFromSnapshot, exportParamsFromSnapshot, exportVariantsOf, filterItems, moveSelection, thumbKey, variantsFromSnapshot } from '../../lib/review/model'
import { estimateExportBytes, exportJobZip, exportTargets } from '../../lib/review/exportJob'
import { JobStatusBadge, ProgressBar } from './badges'
import { JobActions } from './JobActions'
import { ReviewGrid } from './review/ReviewGrid'
import { ReviewToolbar } from './review/ReviewToolbar'
import { ReviewLightbox } from './review/ReviewLightbox'
import { LayoutSettingsDrawer } from './review/LayoutSettingsDrawer'
import { RerunDialog } from './review/RerunDialog'
import { ExportDialog, type ExportDialogState } from './review/ExportDialog'
import { BG_ORDER } from './review/reviewStyles'
import { showToast } from '../../hooks/useToast'

const isTypingTarget = (t: EventTarget | null) => { const tag = (t as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' }

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const teamId = useBatchStore((s) => s.teamId)
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const realtimeOk = useBatchStore((s) => s.realtimeOk)
  const showCost = useBatchStore((s) => s.showCost)
  const memberNames = useBatchStore((s) => s.memberNames)
  const bump = useBatchStore((s) => s.bump)

  const [job, setJob] = useState<BatchJobDetail | null>(null)
  const [items, setItems] = useState<BatchItemRow[]>([])
  const [tasks, setTasks] = useState<BatchTaskRow[]>([])
  const [knownThumbs, setKnownThumbs] = useState<BatchOutputRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingLayout, setSavingLayout] = useState(false)
  const [rerunOpen, setRerunOpen] = useState(false)
  const [rerunBusy, setRerunBusy] = useState(false)
  const [exportScope, setExportScope] = useState<'ok' | 'all' | null>(null)
  const [exportState, setExportState] = useState<ExportDialogState>({ phase: 'idle' })
  const exportCancel = useRef(false)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)

  // ReviewGrid の状態
  const bg = useReviewStore((s) => s.bg)
  const filter = useReviewStore((s) => s.filter)
  const selection = useReviewStore((s) => s.selection)
  const lightbox = useReviewStore((s) => s.lightbox)
  const thumbs = useReviewStore((s) => s.thumbs)
  const progress = useReviewStore((s) => s.progress)
  const executorKind = useReviewStore((s) => s.executorKind)
  const setBg = useReviewStore((s) => s.setBg)
  const setFilter = useReviewStore((s) => s.setFilter)
  const setSelection = useReviewStore((s) => s.setSelection)
  const setLightbox = useReviewStore((s) => s.setLightbox)

  // ── 読み込み ──
  const loadAll = useCallback(async () => {
    if (!jobId) return
    try {
      const [j, its, ts] = await Promise.all([fetchJobDetail(jobId), fetchJobItems(jobId), fetchJobTasks(jobId)])
      if (!j) { setNotFound(true); return }
      const th = await fetchJobThumbs(its.map((i) => i.id)).catch(() => [] as BatchOutputRow[])
      setJob(j); setItems(its); setTasks(ts); setKnownThumbs(th); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [jobId])
  const reloadTasks = useCallback(async () => {
    if (!jobId) return
    try { setTasks(await fetchJobTasks(jobId)) } catch { /* 次回 */ }
  }, [jobId])

  useEffect(() => {
    if (!jobId) return
    useReviewStore.getState().open(jobId)
    setLoading(true)
    void loadAll().finally(() => setLoading(false))
    return () => { useReviewStore.getState().close() }
  }, [jobId, loadAll])
  // ジョブ行（上書き設定を含む）は Realtime → jobsVersion で再取得。タスクの結果も一緒に
  const firstVersion = useRef(true)
  useEffect(() => {
    if (firstVersion.current) { firstVersion.current = false; return }
    void loadAll()
  }, [jobsVersion, loadAll])

  // アイテムの購読（状態・確認結果）。状態が変わったら結果ファイルも取り直す
  const tasksTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!jobId || realtimeOk === false) return
    const unsub = subscribeJobItems(jobId, (payload) => {
      if (payload.eventType === 'DELETE') { const old = payload.old as { id?: string }; if (old?.id) setItems((prev) => prev.filter((i) => i.id !== old.id)); return }
      const row = payload.new as unknown as BatchItemRow
      if (!row?.id) return
      setItems((prev) => {
        const next = { ...row, warnings: Array.isArray(row.warnings) ? row.warnings : [] }
        const idx = prev.findIndex((i) => i.id === row.id)
        if (idx < 0) return [...prev, next].sort((a, b) => a.sort_order - b.sort_order)
        const copy = prev.slice(); copy[idx] = { ...prev[idx], ...next }; return copy
      })
      if (payload.eventType === 'UPDATE' && (payload.old as { status?: string })?.status !== row.status) {
        if (tasksTimer.current) clearTimeout(tasksTimer.current)
        tasksTimer.current = setTimeout(() => { void reloadTasks() }, 400)
      }
    })
    return () => { unsub(); if (tasksTimer.current) clearTimeout(tasksTimer.current) }
  }, [jobId, realtimeOk, reloadTasks])

  // ── 派生 ──
  const variants = useMemo(() => (job ? variantsFromSnapshot(job.workflow_snapshot, job.layout_overrides) : []), [job])
  const cutoutNode = useMemo(() => (job ? cutoutNodesFromSnapshot(job.workflow_snapshot)[0] ?? null : null), [job])
  const exportParams = useMemo<ExportParams>(() => exportParamsFromSnapshot(job?.workflow_snapshot), [job])
  const ctx = useMemo<ReviewContext | null>(() => (job && teamId ? {
    teamId, jobId: job.id, items, tasks, variants, cutoutNodeId: cutoutNode?.nodeId ?? null,
    cutoutParams: cutoutNode?.params ?? ({ engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '2048x2048', alphaThreshold: 8, featherPx: 0, previewBg: 'checker' } as CutoutParams),
    knownThumbs, backgroundUrls: {},
  } : null), [job, teamId, items, tasks, variants, cutoutNode, knownThumbs])
  useEffect(() => { if (ctx) void useReviewStore.getState().sync(ctx) }, [ctx])

  const visibleItems = useMemo(() => filterItems(items, filter), [items, filter])
  const counts = useMemo(() => ({
    all: items.length, ok: items.filter((i) => i.review === 'ok').length, ng: items.filter((i) => i.review === 'ng').length,
    unreviewed: items.filter((i) => i.review === 'unreviewed').length, failed: items.filter((i) => i.status === 'failed').length,
  }), [items])
  const readyCount = useMemo(() => (ctx ? exportTargets(ctx, 'all').length : 0), [ctx])
  const colKeys = useMemo(() => [CUTOUT_VARIANT_KEY, ...variants.map((v) => v.key)], [variants])
  const nameOf = useCallback((id: string | null) => (id && memberNames[id]) || (id ? `${id.slice(0, 8)}…` : '不明'), [memberNames])

  // ── 判定 ──
  const setReview = useCallback(async (item: BatchItemRow, review: BatchReview) => {
    if (reviewing) return
    const next = item.review === review ? 'unreviewed' : review
    setReviewing(item.id)
    const prev = items
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, review: next, reviewed_by: userId } : i)))
    try { await reviewItem(item.id, next) } catch (e) { setItems(prev); showToast(e instanceof Error ? e.message : String(e), 'error') } finally { setReviewing(null) }
  }, [reviewing, items, userId])

  // ── キーボード（グリッド） ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (lightbox || isTypingTarget(e.target) || settingsOpen || rerunOpen || exportScope) return
      const rows = visibleItems.length, cols = colKeys.length
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); setSelection(moveSelection(selection, e.key, rows, cols)); return }
      const item = selection ? visibleItems[selection.row] : undefined
      if ((e.key === 'o' || e.key === 'O') && item) { e.preventDefault(); void setReview(item, 'ok') }
      else if ((e.key === 'n' || e.key === 'N') && item) { e.preventDefault(); void setReview(item, 'ng') }
      else if ((e.key === 'Enter' || e.key === ' ') && item && selection) { e.preventDefault(); setLightbox({ itemId: item.id, variantKey: colKeys[selection.col] ?? CUTOUT_VARIANT_KEY }) }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setBg(BG_ORDER[(BG_ORDER.indexOf(bg) + 1) % BG_ORDER.length]) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [lightbox, settingsOpen, rerunOpen, exportScope, visibleItems, colKeys, selection, setSelection, setReview, setLightbox, bg, setBg])

  // ── 拡大表示 ──
  const lbItem = lightbox ? items.find((i) => i.id === lightbox.itemId) ?? null : null
  const lbIdx = lbItem ? visibleItems.findIndex((i) => i.id === lbItem.id) : -1
  useEffect(() => {
    const path = lbItem?.source_path ?? lbItem?.interactive_path ?? null
    if (!path) { setOriginalUrl(null); return }
    let alive = true
    signBatchPath(path).then((u) => { if (alive) setOriginalUrl(u) }).catch(() => { if (alive) setOriginalUrl(null) })
    return () => { alive = false }
  }, [lbItem])
  const renderFull = useCallback((itemId: string, variantKey: string) => useReviewStore.getState().renderFull(itemId, variantKey), [])

  // ── レイアウト設定（ジョブ単位・fal は呼ばない） ──
  const applyOverrides = useCallback(async (overrides: Record<string, unknown>) => {
    if (!job) return
    setSavingLayout(true)
    try { await setJobLayoutOverrides(job.id, overrides); await loadAll(); showToast('レイアウト設定を全アイテムに再適用しました', 'success'); setSettingsOpen(false) }
    catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setSavingLayout(false) }
  }, [job, loadAll])

  // ── NG のみ再実行 ──
  const runRerun = useCallback(async (params: CutoutParams) => {
    if (!job || !cutoutNode) return
    const ngIds = items.filter((i) => i.review === 'ng').map((i) => i.id)
    setRerunBusy(true)
    try {
      const r = await batchRerun({ jobId: job.id, nodeId: cutoutNode.nodeId, itemIds: ngIds, params })
      if (!r.rerunTasks) { showToast(`再実行できるアイテムがありません（${r.skipped.map((s) => s.reason).join(', ')}）`, 'warning'); return }
      await submitJobFully(job.id)
      showToast(`NG の ${r.rerunTasks} 枚を再投入しました。完了すると結果が差し替わります`, 'success')
      setRerunOpen(false)
      bump(); await loadAll()
    } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setRerunBusy(false) }
  }, [job, cutoutNode, items, bump, loadAll])

  // ── 書き出し ──
  const startExport = useCallback(async (params: ExportParams) => {
    if (!ctx || !job || !exportScope) return
    exportCancel.current = false
    setExportState({ phase: 'running', progress: { done: 0, total: 0, message: '準備中…' } })
    try {
      const out = await exportJobZip({ ctx, jobName: job.name, scope: exportScope, params, executor: useReviewStore.getState().getExecutor(), isCancelled: () => exportCancel.current, onProgress: (p) => setExportState({ phase: 'running', progress: p }) })
      if (out.cancelled || !out.blob) { setExportState({ phase: 'cancelled', result: out }); return }
      downloadBlob(out.blob, out.name)
      setExportState({ phase: 'done', result: out })
    } catch (e) {
      setExportState({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }, [ctx, job, exportScope])

  const nameOfReviewer = nameOf
  if (loading) return <div className="flex items-center justify-center h-48"><CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} /></div>
  if (notFound || !job) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{error ? `読み込みに失敗しました: ${error}` : 'ジョブが見つかりません（削除されたか、閲覧できないワークスペースのジョブです）'}</p>
        <button onClick={() => navigate('/jobs')} className="px-3 h-8 rounded-lg text-[12px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>ジョブ一覧へ</button>
      </div>
    )
  }
  const p = jobProgress(job)
  const summary = { ready: items.filter((i) => i.status === 'ready').length, processing: items.filter((i) => i.status === 'processing').length, pending: items.filter((i) => i.status === 'pending').length, failed: counts.failed }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <button onClick={() => navigate('/jobs')} className="flex items-center gap-1 text-[11px] mb-2 transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-tertiary)' }}><ArrowLeft size={12} />ジョブ一覧</button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-[18px] font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={job.name}>{job.name}</h1>
              <JobStatusBadge status={job.status} />
            </div>
            <div className="flex items-center gap-3 mt-2 text-[12px] flex-wrap" style={{ color: 'var(--text-secondary)' }}>
              <span className="flex items-center gap-2"><ProgressBar done={p.done} failed={p.failed} total={p.total} width={140} /><span className="tabular-nums">{p.total ? `${p.done + p.failed} / ${p.total} タスク` : '投入中'}</span></span>
              {p.failed > 0 && <span className="font-semibold" style={{ color: '#EF4444' }}>失敗 {p.failed}</span>}
              <span>投入者: {nameOf(job.created_by)}</span>
              <span className="tabular-nums">投入 {formatJst(job.created_at)}</span>
              <span className="tabular-nums">{job.item_count} 枚{showCost && <> · 実績 {formatCost(job.actual_cost_usd)}（見積 {formatCost(job.estimated_cost_usd)}）</>}</span>
              <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>準備完了 {summary.ready} · 処理中 {summary.processing} · 待機 {summary.pending} · <span style={{ color: summary.failed ? '#EF4444' : undefined }}>失敗 {summary.failed}</span></span>
            </div>
          </div>
          <div className="shrink-0"><JobActions job={job} onDeleted={() => navigate('/jobs')} /></div>
        </div>
      </div>

      <ReviewToolbar
        bg={bg} onBg={setBg} filter={filter} onFilter={setFilter} counts={counts} progress={progress} executorKind={executorKind} readyCount={readyCount}
        busy={rerunBusy || savingLayout || exportState.phase === 'running'}
        onExport={(scope) => { setExportScope(scope); setExportState({ phase: 'idle' }) }}
        onRerun={() => setRerunOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="flex-1 overflow-auto px-8 py-4">
        {variants.length === 0 && (
          <div className="mb-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: '#F59E0B' }}>
            投入時のワークフローに Product Layout ノードが無いため、切り抜き列だけを表示しています。「レイアウト設定」からバリアントを追加すると、切り抜きを再実行せずにレイアウトを作れます（追加しない場合の書き出しは切り抜きの透過 PNG）。
          </div>
        )}
        <ReviewGrid
          items={visibleItems} variants={variants} thumbs={thumbs} bg={bg} selection={selection}
          onSelect={setSelection}
          onOpen={(itemId, variantKey) => setLightbox({ itemId, variantKey })}
          onReview={setReview} reviewing={reviewing} nameOf={nameOfReviewer}
        />
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          クリックで選択、ダブルクリックまたは Enter で拡大。矢印キーで移動、O / N で判定（もう一度押すと取り消し）、B で背景切替。サムネイルは長辺 400px で描画し、保存して次回から再利用します。
        </p>
      </div>

      {lightbox && lbItem && (
        <ReviewLightbox
          item={lbItem} variantKey={lightbox.variantKey} variants={variants} thumb={thumbs[thumbKey(lbItem.id, lightbox.variantKey)]}
          bg={bg} onBg={setBg} originalUrl={originalUrl} renderFull={renderFull}
          onClose={() => setLightbox(null)}
          onPrev={() => { const n = visibleItems[lbIdx - 1]; if (n) setLightbox({ itemId: n.id, variantKey: lightbox.variantKey }) }}
          onNext={() => { const n = visibleItems[lbIdx + 1]; if (n) setLightbox({ itemId: n.id, variantKey: lightbox.variantKey }) }}
          onVariant={(key) => setLightbox({ itemId: lbItem.id, variantKey: key })}
          onReview={(r) => void setReview(lbItem, r)}
          hasPrev={lbIdx > 0} hasNext={lbIdx >= 0 && lbIdx < visibleItems.length - 1}
        />
      )}
      <LayoutSettingsDrawer open={settingsOpen} variants={variants} saving={savingLayout} onClose={() => setSettingsOpen(false)} onApply={applyOverrides} onReset={() => applyOverrides({})} />
      <RerunDialog open={rerunOpen} count={counts.ng} initial={cutoutNode?.params ?? ctx?.cutoutParams ?? ({} as CutoutParams)} busy={rerunBusy} onClose={() => setRerunOpen(false)} onConfirm={(params) => void runRerun(params)} />
      <ExportDialog
        open={!!exportScope} scope={exportScope ?? 'all'} initialParams={exportParams}
        targetCount={ctx && exportScope ? exportTargets(ctx, exportScope).length : 0} variantNames={exportVariantsOf(variants).map((v) => v.name)}
        sampleSku={items[0]?.sku ?? null} estimateBytes={ctx && exportScope ? estimateExportBytes(ctx, exportScope, exportParams) : 0}
        state={exportState} onStart={(params) => void startExport(params)} onCancel={() => { exportCancel.current = true }}
        onClose={() => { if (exportState.phase !== 'running') { setExportScope(null); setExportState({ phase: 'idle' }) } }}
      />
    </div>
  )
}
