// ジョブの確認グリッド一式（読み込み・列・サムネイル・拡大・チェック・再度切り抜く・書き出し・レイアウト設定）。
// ジョブ管理画面（mode 'page'）と、キャンバスの一括結果ノード（mode 'node'・フェーズ C(b)）が同じ部品を使う。
// node モードの違い: バリアントと背景はキャンバスの現在のノード（liveCanvas）から取る（Product Layout を直すとその場で描き直す）、
// レイアウト設定の引き出しは出さない（ノードで変える）、キーボードはノード内にフォーカスがある間だけ、余白を詰める。
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, ArrowSquareOut, CircleNotch } from '@phosphor-icons/react'
import { useBatchStore } from '../../../stores/batchStore'
import { useAuthStore } from '../../../stores/authStore'
import { fetchJobDetail, fetchJobItems, fetchJobTasks, fetchJobThumbs, fetchJobWorkflowSource, fetchWorkflowFull, saveWorkflowCanvasChecked, setJobLayoutOverrides, subscribeJobItems, type WorkflowSource } from '../../../lib/api/batchJobs'
import { batchRerun, submitJobFully } from '../../../lib/api/batch'
import { signBatchPath } from '../../../lib/cutout/store'
import { jobProgress } from '../../../lib/batch/jobsQuery'
import { formatJst } from '../../../lib/batch/dates'
import { formatCost } from '../../../lib/batch/cost'
import { downloadBlob } from '../../../lib/export/zip'
import type { CutoutParams, ExportParams } from '../../../types/nodes'
import type { BatchItemRow, BatchJobDetail, BatchOutputRow, BatchTaskRow } from '../../../types/batch'
import type { ReviewContext, ReviewStoreHook } from '../../../lib/review/reviewStore'
import {
  ADDED_VARIANTS_KEY, CUTOUT_VARIANT_KEY, addLayoutNodeToCanvas, addedVariantsOf, cutoutNodesFromSnapshot, exportParamsFromSnapshot, filterItems, isResultKey, moveFocus,
  removeLayoutNodeFromCanvas, resultColumnsOf, resultNodeIdOf, thumbKey, updateLayoutNodeParams, variantsFromSnapshot, type CanvasLike, type Snapshot, layoutSaveTargetFor } from '../../../lib/review/model'
import { estimateExportBytes, exportColumnsFor, exportFileCount, exportJobZip, exportTargets, type ExportScope } from '../../../lib/review/exportJob'
import { JobStatusBadge, ProgressBar } from '../badges'
import { JobActions } from '../JobActions'
import { ReviewGrid } from './ReviewGrid'
import { ReviewTabs, ReviewToolbar } from './ReviewToolbar'
import { ReviewLightbox } from './ReviewLightbox'
import { LayoutSettingsDrawer, type LayoutChangePlan, type LayoutSaveTarget } from './LayoutSettingsDrawer'
import { acquireEditLock, releaseEditLock } from '../../../lib/api/workflowLocks'
import { signMediaRequest } from '../../../lib/api/storage'
import { resolveBackgroundSource, type BgCanvas } from '../../../lib/batch/background'
import { editSessionId, holderLabel, lockRequiredFor } from '../../../lib/workflow/editLock'
import { RerunDialog } from './RerunDialog'
import { ExportDialog, type ExportDialogState } from './ExportDialog'
import { BG_ORDER } from './reviewStyles'
import { showToast } from '../../../hooks/useToast'

const isTypingTarget = (t: EventTarget | null) => { const tag = (t as HTMLElement | null)?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' }
const DEFAULT_CUTOUT: CutoutParams = { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '2048x2048', alphaThreshold: 8, featherPx: 0, previewBg: 'checker' } as CutoutParams

export interface JobReviewPanelProps {
  jobId: string
  store: ReviewStoreHook
  mode: 'page' | 'node'
  /** node モード: キャンバスの現在のノード（バリアント・背景・Export 設定の出どころ） */
  liveCanvas?: CanvasLike | null
  /** 削除後（node: 一覧を取り直す / page: 一覧へ戻る） */
  onDeleted?: () => void
}

type KeyLike = { key: string; target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }

export function JobReviewPanel({ jobId, store: useReview, mode, liveCanvas, onDeleted }: JobReviewPanelProps) {
  const navigate = useNavigate()
  const isNode = mode === 'node'
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
  const [source, setSource] = useState<WorkflowSource | null>(null)          // 投入元ワークフローの現在の内容（page モード・読めるとき）
  const [backgroundUrls, setBackgroundUrls] = useState<Record<string, string>>({})   // 背景入力ノード ID → 署名 URL（Step 8）
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingLayout, setSavingLayout] = useState(false)
  const [rerunOpen, setRerunOpen] = useState(false)
  const [rerunBusy, setRerunBusy] = useState(false)
  const [exportScope, setExportScope] = useState<ExportScope | null>(null)
  const [columns, setColumns] = useState(1)   // カードグリッドの 1 行あたりの枚数（矢印キー用）
  const [exportState, setExportState] = useState<ExportDialogState>({ phase: 'idle' })
  const exportCancel = useRef(false)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // ReviewGrid の状態
  const bg = useReview((s) => s.bg)
  const filter = useReview((s) => s.filter)
  const focusId = useReview((s) => s.focusId)
  const activeKey = useReview((s) => s.activeKey)
  const selected = useReview((s) => s.selected)
  const lightbox = useReview((s) => s.lightbox)
  const thumbs = useReview((s) => s.thumbs)
  const progress = useReview((s) => s.progress)
  const executorKind = useReview((s) => s.executorKind)
  const setBg = useReview((s) => s.setBg)
  const setFilter = useReview((s) => s.setFilter)
  const setFocusId = useReview((s) => s.setFocusId)
  const setActiveKey = useReview((s) => s.setActiveKey)
  const toggleSelected = useReview((s) => s.toggleSelected)
  const setSelected = useReview((s) => s.setSelected)
  const clearSelected = useReview((s) => s.clearSelected)
  const setLightbox = useReview((s) => s.setLightbox)

  // ── 読み込み ──
  const loadAll = useCallback(async () => {
    try {
      const [j, its, ts] = await Promise.all([fetchJobDetail(jobId), fetchJobItems(jobId), fetchJobTasks(jobId)])
      if (!j) { setNotFound(true); return }
      const th = await fetchJobThumbs(its.map((i) => i.id)).catch(() => [] as BatchOutputRow[])
      const src = !isNode && j.workflow_id ? await fetchJobWorkflowSource(j.id, j.workflow_id) : null
      setJob(j); setItems(its); setTasks(ts); setKnownThumbs(th); setSource(src); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [jobId, isNode])
  const reloadTasks = useCallback(async () => {
    try { setTasks(await fetchJobTasks(jobId)) } catch { /* 次回 */ }
  }, [jobId])

  useEffect(() => {
    useReview.getState().open(jobId)
    setLoading(true)
    void loadAll().finally(() => setLoading(false))
    return () => { useReview.getState().close() }
  }, [jobId, loadAll, useReview])
  // page: キャンバス側でノードを変えたら、タブに戻ったときに列へ反映する
  const reloadSource = useCallback(async () => {
    if (isNode || !job?.id || !job.workflow_id) return
    const src = await fetchJobWorkflowSource(job.id, job.workflow_id)
    setSource((prev) => (src && prev && src.updatedAt === prev.updatedAt ? prev : src))
  }, [isNode, job?.id, job?.workflow_id])
  useEffect(() => {
    if (isNode) return
    const h = () => { if (document.visibilityState === 'visible') void reloadSource() }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [isNode, reloadSource])
  // ジョブ行（上書き設定を含む）は Realtime → jobsVersion で再取得。タスクの結果も一緒に
  const firstVersion = useRef(true)
  useEffect(() => {
    if (firstVersion.current) { firstVersion.current = false; return }
    void loadAll()
  }, [jobsVersion, loadAll])

  // アイテムの購読（状態・確認結果）。状態が変わったら結果ファイルも取り直す
  const tasksTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (realtimeOk === false) return
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
  // バリアントの出どころ: node = キャンバスの現在のノード / page = 元ワークフローが読めればその現在のノード、読めなければ投入時の写し
  const isCreator = !!job && !!userId && job.created_by === userId
  const target: LayoutSaveTarget = isNode ? 'readonly' : layoutSaveTargetFor(isCreator, source, userId)
  const readOnlyNotice = source && target === 'readonly' ? '編集できるのはワークフローの所有者（「チームの編集を許可」がオンなら同じチームのメンバーも）だけです。ここでは設定の確認のみ。' : null
  const variants = useMemo(() => {
    if (!job) return []
    if (isNode && liveCanvas) return variantsFromSnapshot(liveCanvas as Snapshot, { [ADDED_VARIANTS_KEY]: addedVariantsOf(job.layout_overrides) })
    if (source) return variantsFromSnapshot(source.canvas as CanvasLike, { [ADDED_VARIANTS_KEY]: addedVariantsOf(job.layout_overrides) })
    return variantsFromSnapshot(job.workflow_snapshot, job.layout_overrides)
  }, [job, source, isNode, liveCanvas])
  // 背景画像（Step 8）: 背景が「画像」のバリアントについて、生成器（ジョブごとタスク）の結果か固定画像を署名して渡す
  useEffect(() => {
    if (!job) return
    const canvas = ((isNode && liveCanvas) ? liveCanvas : (source?.canvas ?? job.workflow_snapshot)) as unknown as BgCanvas
    const wanted = variants.filter((v) => v.backgroundNodeId && v.params.backgroundKind === 'image')
    if (!wanted.length) { setBackgroundUrls({}); return }
    let cancelled = false
    void (async () => {
      const byPath: Record<string, string> = {}, byUrl: Record<string, string> = {}
      for (const v of wanted) {
        const src = resolveBackgroundSource(canvas, v.key)
        if (!src) continue
        if (src.generatorNodeId) {
          const t = tasks.find((x) => x.item_id === null && x.node_id === src.generatorNodeId && x.status === 'completed' && x.result_path)
          if (t?.result_path) byPath[src.sourceNodeId] = t.result_path
        } else {
          const d = canvas.nodes?.find((n) => n.id === src.sourceNodeId)?.data
          const u = typeof d?.output === 'string' ? d.output : typeof d?.imageUrl === 'string' ? d.imageUrl : null
          if (u) byUrl[src.sourceNodeId] = u
        }
      }
      const out: Record<string, string> = {}
      if (Object.keys(byPath).length) { const m = await signMediaRequest({ batchPaths: Object.values(byPath) }); for (const [nid, p] of Object.entries(byPath)) if (m[p]) out[nid] = m[p] }
      if (Object.keys(byUrl).length) { const m = await signMediaRequest({ urls: Object.values(byUrl), workflowId: job.workflow_id ?? undefined }); for (const [nid, u] of Object.entries(byUrl)) if (m[u]) out[nid] = m[u] }
      if (!cancelled) setBackgroundUrls((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out))
    })()
    return () => { cancelled = true }
  }, [job, source, tasks, variants, isNode, liveCanvas])
  const hasJobOverrides = !!job && Object.keys(job.layout_overrides).length > 0
  // 一括実行の切り抜きノード（写真に 2 段以内で行き着く Remove Background。レタッチ → 切り抜き の連鎖も含む）
  const cutoutNode = useMemo(() => (job ? cutoutNodesFromSnapshot(job.workflow_snapshot)[0] ?? null : null), [job])
  // 生成結果の列（写真ごとの Image Generation ノード。タスク行から作る。フェーズ C(a)）
  const results = useMemo(() => resultColumnsOf(tasks, job?.workflow_snapshot), [tasks, job])
  // 書き出し設定: node はキャンバスの Export ノードの今の設定、page は投入時の写し
  const exportParams = useMemo<ExportParams>(() => exportParamsFromSnapshot((isNode && liveCanvas ? liveCanvas : job?.workflow_snapshot) as Snapshot | undefined), [job, isNode, liveCanvas])
  const ctx = useMemo<ReviewContext | null>(() => (job && teamId ? {
    teamId, jobId: job.id, items, tasks, variants, results, cutoutNodeId: cutoutNode?.nodeId ?? null,
    cutoutParams: cutoutNode?.params ?? DEFAULT_CUTOUT,
    knownThumbs, backgroundUrls,
  } : null), [job, teamId, items, tasks, variants, results, cutoutNode, knownThumbs, backgroundUrls])
  useEffect(() => { if (ctx) void useReview.getState().sync(ctx) }, [ctx, useReview])

  const visibleItems = useMemo(() => filterItems(items, filter), [items, filter])
  const counts = useMemo(() => ({ all: items.length, failed: items.filter((i) => i.status === 'failed').length }), [items])
  const readyCount = useMemo(() => (ctx ? exportTargets(ctx, 'all').length : 0), [ctx])
  const exportTargetList = useMemo(() => (ctx && exportScope ? exportTargets(ctx, exportScope, selected) : []), [ctx, exportScope, selected])
  // 書き出しダイアログの要約（設定の変更に追従: 切り抜きを含めるか・形式）
  const summarizeExport = useCallback((p: ExportParams) => {
    if (!ctx || !exportScope) return { columnNames: [] as string[], fileCount: 0, estimateBytes: 0 }
    const targets = exportTargets(ctx, exportScope, selected)
    return { columnNames: exportColumnsFor(ctx, p.includeCutout).map((c) => c.name), fileCount: exportFileCount(ctx, targets, p.includeCutout), estimateBytes: estimateExportBytes(ctx, exportScope, p, selected) }
  }, [ctx, exportScope, selected])
  // 生成結果の列を表示中: 結果画像の大きさ（枠の比率）
  const resultSizes = useMemo(() => {
    if (!isResultKey(activeKey)) return null
    const nodeId = resultNodeIdOf(activeKey)
    const m: Record<string, { w: number; h: number }> = {}
    for (const t of tasks) if (t.node_id === nodeId && t.item_id && t.result_meta?.width && t.result_meta?.height) m[t.item_id] = { w: t.result_meta.width, h: t.result_meta.height }
    return m
  }, [activeKey, tasks])
  const nameOf = useCallback((id: string | null) => (id && memberNames[id]) || (id ? `${id.slice(0, 8)}…` : '不明'), [memberNames])
  // チェック中の写真（削除済みの id は数えない）
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected])
  // 列のタブ（切り抜き + バリアント + 生成結果）。切り抜きノードが無いジョブはレイアウト系の列を持たない。表示中の列が無くなったら先頭へ
  const tabs = useMemo(() => [
    ...(cutoutNode ? [
      { key: CUTOUT_VARIANT_KEY, name: '切り抜き', size: '元のサイズ' },
      ...variants.map((v) => ({ key: v.key, name: v.name, size: `${v.params.width}×${v.params.height}` })),
    ] : []),
    ...results.map((r) => ({ key: r.key, name: r.name, size: '生成結果' })),
  ], [cutoutNode, variants, results])
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.key === activeKey)) setActiveKey(tabs[0].key)
  }, [tabs, activeKey, setActiveKey])

  // ── キーボード（カードグリッド）: 矢印で移動、Space でチェック、Enter で拡大、B で背景。page は画面全体、node はノード内にフォーカスがある間 ──
  const handleKey = useCallback((e: KeyLike) => {
    if (lightbox || isTypingTarget(e.target) || settingsOpen || rerunOpen || exportScope) return
    const idx = focusId ? visibleItems.findIndex((i) => i.id === focusId) : -1
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation()
      const n = moveFocus(idx >= 0 ? idx : null, e.key, visibleItems.length, columns)
      if (n !== null && visibleItems[n]) setFocusId(visibleItems[n].id)
      return
    }
    const item = idx >= 0 ? visibleItems[idx] : undefined
    if (e.key === ' ' && item) { e.preventDefault(); e.stopPropagation(); toggleSelected(item.id) }
    else if (e.key === 'Enter' && item) { e.preventDefault(); e.stopPropagation(); setLightbox({ itemId: item.id, variantKey: activeKey }) }
    else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); e.stopPropagation(); setBg(BG_ORDER[(BG_ORDER.indexOf(bg) + 1) % BG_ORDER.length]) }
  }, [lightbox, settingsOpen, rerunOpen, exportScope, visibleItems, focusId, columns, setFocusId, toggleSelected, setLightbox, activeKey, bg, setBg])
  useEffect(() => {
    if (isNode) return
    const h = (e: KeyboardEvent) => handleKey(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isNode, handleKey])
  const onRootKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => { if (isNode) handleKey(e) }, [isNode, handleKey])

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
  const renderFull = useCallback((itemId: string, variantKey: string) => useReview.getState().renderFull(itemId, variantKey), [useReview])

  // ── レイアウト設定（page のみ・fal は呼ばない）: 本人のワークフローならノードに書き戻す。それ以外はジョブにだけ保存 ──
  const applyPlan = useCallback(async (plan: LayoutChangePlan) => {
    if (!job) return
    setSavingLayout(true)
    try {
      const jobAdded = addedVariantsOf(job.layout_overrides)
      if (target === 'workflow' && source) {
        // チーム編集のワークフローは保存にロックが要る（キャンバスを編集中の人がいれば保存しない）。書き戻しの間だけ取り、終わったら返す
        const needLock = lockRequiredFor({ team_edit: source.teamEdit, visibility: source.visibility })
        const sid = editSessionId(typeof sessionStorage !== 'undefined' ? sessionStorage : null, () => crypto.randomUUID())
        if (needLock) {
          const r = await acquireEditLock(source.id, sid)
          if (!r.ok) {
            showToast(r.reason === 'held' ? `${holderLabel({ holderEmail: r.holder_email ?? null })} がキャンバスを編集中のため、いま保存できません` : 'このワークフローを編集する権限がありません', 'warning')
            return
          }
        }
        try {
          // 書き戻しはワークフロー全体が必要。最新を取り直してから差分を当て、読み込んだ版のまま保存する（他の保存と重なれば保存しない）
          const fresh = await fetchWorkflowFull(source.id)
          if (!fresh) throw new Error('元のワークフローを読み込めませんでした（編集権限がありません）')
          let canvas: CanvasLike = fresh.canvas as CanvasLike
          const nodeIds = new Set((Array.isArray(canvas.nodes) ? canvas.nodes : []).map((n) => n.id))
          let added = jobAdded
          for (const [key, params] of Object.entries(plan.updated)) {
            if (nodeIds.has(key)) canvas = updateLayoutNodeParams(canvas, key, params)
            else added = added.map((a) => (a.key === key ? { key, params } : a))
          }
          for (const key of plan.removed) {
            if (nodeIds.has(key)) canvas = removeLayoutNodeFromCanvas(canvas, key)
            else added = added.filter((a) => a.key !== key)
          }
          for (const a of plan.added) canvas = addLayoutNodeToCanvas(canvas, a.params).canvas
          const saved = await saveWorkflowCanvasChecked(source.id, canvas, fresh.canvasVersion)
          if (!saved) {
            showToast('他の保存と重なったため保存しませんでした。列を読み直したので、もう一度お試しください', 'warning')
            await reloadSource()
            return
          }
          const overrides: Record<string, unknown> = added.length ? { [ADDED_VARIANTS_KEY]: added } : {}
          if (JSON.stringify(overrides) !== JSON.stringify(job.layout_overrides)) await setJobLayoutOverrides(job.id, overrides)
          showToast('ワークフローのノードを更新し、全アイテムに再適用しました', 'success')
        } finally {
          if (needLock) void releaseEditLock(source.id, sid)
        }
      } else {
        const overrides: Record<string, unknown> = { ...job.layout_overrides }
        delete overrides[ADDED_VARIANTS_KEY]
        let added = jobAdded
        for (const [key, params] of Object.entries(plan.updated)) {
          if (added.some((a) => a.key === key)) added = added.map((a) => (a.key === key ? { key, params } : a))
          else overrides[key] = params
        }
        for (const key of plan.removed) { added = added.filter((a) => a.key !== key); delete overrides[key] }
        added = [...added, ...plan.added]
        if (added.length) overrides[ADDED_VARIANTS_KEY] = added
        await setJobLayoutOverrides(job.id, overrides)
        showToast('レイアウト設定を全アイテムに再適用しました', 'success')
      }
      await loadAll()
      setSettingsOpen(false)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSavingLayout(false)
    }
  }, [job, source, target, loadAll, reloadSource])
  const resetJobOverrides = useCallback(async () => {
    if (!job) return
    setSavingLayout(true)
    try { await setJobLayoutOverrides(job.id, {}); await loadAll(); showToast('ジョブ側の変更を消しました', 'success') }
    catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setSavingLayout(false) }
  }, [job, loadAll])

  // ── チェックした写真を再度切り抜く ──
  const runRerun = useCallback(async (params: CutoutParams) => {
    if (!job || !cutoutNode) return
    const ngIds = items.filter((i) => selected.has(i.id)).map((i) => i.id)
    if (!ngIds.length) { showToast('写真をチェックしてください', 'warning'); return }
    setRerunBusy(true)
    try {
      const r = await batchRerun({ jobId: job.id, nodeId: cutoutNode.nodeId, itemIds: ngIds, params })
      if (!r.rerunTasks) { showToast(`再実行できる写真がありません（${r.skipped.map((s) => s.reason).join(', ')}）`, 'warning'); return }
      await submitJobFully(job.id)
      showToast(`チェックした ${r.rerunTasks} 枚を再投入しました。完了すると結果が差し替わります`, 'success')
      setRerunOpen(false)
      clearSelected()
      bump(); await loadAll()
    } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setRerunBusy(false) }
  }, [job, cutoutNode, items, selected, clearSelected, bump, loadAll])

  // ── 書き出し ──
  const startExport = useCallback(async (params: ExportParams) => {
    if (!ctx || !job || !exportScope) return
    exportCancel.current = false
    setExportState({ phase: 'running', progress: { done: 0, total: 0, message: '準備中…' } })
    try {
      const out = await exportJobZip({ ctx, jobName: job.name, scope: exportScope, selected, params, executor: useReview.getState().getExecutor(), isCancelled: () => exportCancel.current, onProgress: (p) => setExportState({ phase: 'running', progress: p }) })
      if (out.cancelled || !out.blob) { setExportState({ phase: 'cancelled', result: out }); return }
      downloadBlob(out.blob, out.name)
      setExportState({ phase: 'done', result: out })
    } catch (e) {
      setExportState({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }, [ctx, job, exportScope, selected, useReview])

  if (loading) return <div className="flex items-center justify-center h-48"><CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} /></div>
  if (notFound || !job) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 px-4 text-center">
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{error ? `読み込みに失敗しました: ${error}` : 'ジョブが見つかりません（削除されたか、閲覧できないワークスペースのジョブです）'}</p>
        {!isNode && <button onClick={() => navigate('/jobs')} className="px-3 h-8 rounded-lg text-[12px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>ジョブ一覧へ</button>}
      </div>
    )
  }
  const p = jobProgress(job)
  const summary = { ready: items.filter((i) => i.status === 'ready').length, processing: items.filter((i) => i.status === 'processing').length, pending: items.filter((i) => i.status === 'pending').length, failed: counts.failed }
  const handleDeleted = () => { if (onDeleted) onDeleted(); else navigate('/jobs') }

  return (
    <div ref={rootRef} tabIndex={isNode ? 0 : -1} onKeyDown={onRootKeyDown} className={`flex flex-col h-full min-h-0 outline-none ${isNode ? 'text-[12px]' : ''}`}>
      {/* Header */}
      {isNode ? (
        <div className="flex items-center gap-3 px-3 py-2 border-b shrink-0 text-[11px] flex-wrap" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          <JobStatusBadge status={job.status} />
          <span className="flex items-center gap-2"><ProgressBar done={p.done} failed={p.failed} total={p.total} width={100} /><span className="tabular-nums">{p.total ? `${p.done + p.failed} / ${p.total}` : '投入中'}</span></span>
          <span className="tabular-nums">{job.item_count} 枚 · 準備完了 {summary.ready} · 処理中 {summary.processing}{summary.failed ? <> · <span style={{ color: '#EF4444' }}>失敗 {summary.failed}</span></> : null}</span>
          <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{nameOf(job.created_by)} · {formatJst(job.created_at)}{showCost ? ` · 実績 ${formatCost(job.actual_cost_usd)}` : ''}</span>
          <div className="flex-1" />
          <button onClick={() => navigate(`/jobs/${job.id}`)} className="flex items-center gap-1 h-7 px-2 rounded-md hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} title="ジョブ管理画面で開く"><ArrowSquareOut size={12} />ジョブ管理で開く</button>
          <JobActions job={job} compact onChanged={() => { bump(); void loadAll() }} onDeleted={handleDeleted} />
        </div>
      ) : (
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
            <div className="shrink-0"><JobActions job={job} onDeleted={handleDeleted} /></div>
          </div>
        </div>
      )}

      <ReviewToolbar
        bg={bg} onBg={setBg} filter={filter} onFilter={setFilter} counts={counts} progress={progress} executorKind={executorKind} readyCount={readyCount}
        selectedCount={selectedItems.length} canRerun={!!cutoutNode}
        busy={rerunBusy || savingLayout || exportState.phase === 'running'}
        onSelectAll={() => setSelected([...selected, ...visibleItems.map((i) => i.id)])}
        onSelectFailed={() => setSelected([...selected, ...items.filter((i) => i.status === 'failed').map((i) => i.id)])}
        onClearSelection={clearSelected}
        onExport={(scope) => { setExportScope(scope); setExportState({ phase: 'idle' }) }}
        onRerunSelected={() => setRerunOpen(true)}
        onSettings={isNode ? undefined : () => setSettingsOpen(true)}
        compact={isNode}
      />

      <div className={`flex-1 min-h-0 overflow-auto ${isNode ? 'px-3 py-3' : 'px-8 py-4'}`}>
        {!cutoutNode && results.length > 0 && (
          <div className="mb-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            このジョブには切り抜き（Remove Background）が無いため、生成結果の列だけを表示しています。
          </div>
        )}
        {cutoutNode && variants.length === 0 && (
          <div className="mb-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: '#F59E0B' }}>
            {isNode ? 'このキャンバスに Product Layout ノードが無いため、' : source ? `ワークフロー「${source.name}」に Product Layout ノードが無いため、` : '投入時のワークフローに Product Layout ノードが無いため、'}切り抜き列だけを表示しています。{isNode ? 'Product Layout ノードを切り抜きにつなぐとバリアントの列が増えます（切り抜きの再実行は不要）。' : '「レイアウト設定」からバリアントを追加すると、切り抜きを再実行せずにレイアウトを作れます（追加しない場合の書き出しは切り抜きの透過 PNG）。'}
          </div>
        )}
        {isNode && variants.length > 0 && (
          <div className="mb-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            バリアントはこのキャンバスの Product Layout ノードと連動しています。ノードの設定を変えるとここに自動で反映されます（fal は呼びません）。
          </div>
        )}
        {!isNode && !source && job?.workflow_id && variants.length > 0 && (
          <div className="mb-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            元のワークフローを読み込めないため、投入時のレイアウトを表示しています（列が最新でない可能性があります）。
          </div>
        )}
        {!isNode && source && variants.length > 0 && (
          <div className="mb-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            バリアントはワークフロー「{source.name}」の Product Layout ノードと連動しています{target === 'workflow' ? '（このジョブ画面での変更はノードに書き戻されます）' : '（編集できるのはワークフローの所有者と、編集を許可されたチームのメンバーだけ）'}。
          </div>
        )}
        <ReviewTabs tabs={tabs} activeKey={activeKey} onChange={setActiveKey} />
        <ReviewGrid
          items={visibleItems} variants={variants} activeKey={activeKey} thumbs={thumbs} bg={bg}
          selected={selected} onToggle={toggleSelected}
          focusId={focusId} onFocus={setFocusId}
          onOpen={(itemId) => setLightbox({ itemId, variantKey: activeKey })}
          onColumns={setColumns}
          resultSizes={resultSizes}
        />
        {!isNode && (
          <p className="mt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            タブで列（切り抜き・各バリアント{results.length ? '・生成結果' : ''}）を切り替えます。クリックで選択、ダブルクリックまたは Enter で拡大。矢印キーで移動、Space でチェック、B で背景切替。チェックした写真は「再度切り抜く」「書き出し」の対象になります。サムネイルは長辺 400px で描画し、保存して次回から再利用します。
          </p>
        )}
      </div>

      {lightbox && lbItem && (
        <ReviewLightbox
          item={lbItem} variantKey={lightbox.variantKey} columns={tabs} thumb={thumbs[thumbKey(lbItem.id, lightbox.variantKey)]}
          bg={bg} onBg={setBg} originalUrl={originalUrl} renderFull={renderFull}
          onClose={() => setLightbox(null)}
          onPrev={() => { const n = visibleItems[lbIdx - 1]; if (n) setLightbox({ itemId: n.id, variantKey: lightbox.variantKey }) }}
          onNext={() => { const n = visibleItems[lbIdx + 1]; if (n) setLightbox({ itemId: n.id, variantKey: lightbox.variantKey }) }}
          onVariant={(key) => setLightbox({ itemId: lbItem.id, variantKey: key })}
          checked={selected.has(lbItem.id)} onToggleCheck={() => toggleSelected(lbItem.id)}
          hasPrev={lbIdx > 0} hasNext={lbIdx >= 0 && lbIdx < visibleItems.length - 1}
        />
      )}
      {!isNode && <LayoutSettingsDrawer open={settingsOpen} variants={variants} target={target} sourceName={source?.name ?? null} readOnlyNotice={readOnlyNotice} saving={savingLayout} onClose={() => setSettingsOpen(false)} onApply={applyPlan} onReset={resetJobOverrides} canReset={hasJobOverrides} />}
      <RerunDialog open={rerunOpen} count={selectedItems.length} initial={cutoutNode?.params ?? ctx?.cutoutParams ?? ({} as CutoutParams)} busy={rerunBusy} onClose={() => setRerunOpen(false)} onConfirm={(params) => void runRerun(params)} />
      <ExportDialog
        open={!!exportScope} scope={exportScope ?? 'all'} initialParams={exportParams}
        targetCount={exportTargetList.length} cutoutOptional={!!cutoutNode && variants.length > 0} summarize={summarizeExport}
        sampleSku={items[0]?.sku ?? null}
        state={exportState} onStart={(params) => void startExport(params)} onCancel={() => { exportCancel.current = true }}
        onClose={() => { if (exportState.phase !== 'running') { setExportScope(null); setExportState({ phase: 'idle' }) } }}
      />
    </div>
  )
}
