// 撮影後工程の App モード（フェーズ C(c)）: 左に「写真を投入」、右に「ジョブと結果」。
// ワークフローの中身（ノード）はキャンバスで組み、使う人はこの画面だけで 入力 → 一括実行 → 結果 を完結させる。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowSquareOut, ArrowsClockwise, CircleNotch, Images } from '@phosphor-icons/react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useBatchStore, useWatchBatchJobs } from '../../stores/batchStore'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useLiveCanvas } from '../../hooks/useLiveCanvas'
import { fetchWorkflowJobs } from '../../lib/api/batchJobs'
import { buildWorkflowSnapshot, type CreateItemInput } from '../../lib/api/batch'
import { createReviewStoreHook } from '../../lib/review/reviewStore'
import { normalizeBatchInputParams } from '../../lib/batch/items'
import { formatJst } from '../../lib/batch/dates'
import { JOB_STATUS_META, type BatchJobRow } from '../../types/batch'
import type { NodeData } from '../../types/nodes'
import { JobReviewPanel } from '../jobs/review/JobReviewPanel'
import { AppBatchInput } from './AppBatchInput'

const ACCENT = '#14B8A6'

export function BatchAppView() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const workflowName = useWorkflowStore((s) => s.currentWorkflowName)
  const nodes = useCanvasStore((s) => s.nodes)
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const bump = useBatchStore((s) => s.bump)
  const openSubmitDialogWith = useBatchStore((s) => s.openSubmitDialogWith)
  useWatchBatchJobs('batch-app')

  const batchInput = useMemo(() => nodes.find((n) => (n.data as unknown as NodeData).type === 'batchInput') ?? null, [nodes])
  const skuPattern = useMemo(() => normalizeBatchInputParams((batchInput?.data as unknown as NodeData | undefined)?.params).skuPattern, [batchInput])

  const [jobs, setJobs] = useState<BatchJobRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const store = useMemo(() => createReviewStoreHook(), [])
  useEffect(() => () => store.getState().close(), [store])
  const liveCanvas = useLiveCanvas()

  useEffect(() => {
    let alive = true
    ;(workflowId ? fetchWorkflowJobs(workflowId) : Promise.resolve([] as BatchJobRow[]))
      .then((rows) => { if (!alive) return; setJobs(rows); setError(null) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [workflowId, jobsVersion, reloadTick])
  const current = useMemo(() => (jobs ? jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null : null), [jobs, selectedId])

  const submit = useCallback((items: CreateItemInput[]) => {
    const { nodes: ns, edges } = useCanvasStore.getState()
    openSubmitDialogWith({
      items, snapshot: buildWorkflowSnapshot(ns, edges), workflowId,
      onDone: (jobId) => { setResetKey((k) => k + 1); setSelectedId(jobId); setReloadTick((t) => t + 1); bump() },
    })
  }, [openSubmitDialogWith, workflowId, bump])

  const statusLabel = (j: BatchJobRow) => JOB_STATUS_META[j.status]?.label ?? j.status

  if (!batchInput) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6" style={{ color: 'var(--text-secondary)' }}>
        <div className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>この App には Batch Input がありません</div>
        <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>キャンバスで Batch Input → Remove Background → Product Layout を組むと、ここで写真の投入と結果の確認ができます。</div>
      </div>
    )
  }

  return (
    <div className={`flex-1 min-h-0 flex ${isMobile ? 'flex-col overflow-auto' : 'flex-row'}`} style={{ background: 'var(--bg-canvas)' }}>
      {/* 左: 写真を投入 */}
      <aside className={`${isMobile ? 'w-full' : 'w-[380px] shrink-0 overflow-auto border-r'} px-5 py-4`} style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Images size={16} style={{ color: ACCENT }} />
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>写真を投入</h2>
        </div>
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
          App「{workflowName}」の処理（切り抜き・レイアウト・生成）を、入れた写真すべてに実行します。
        </p>
        <AppBatchInput key={resetKey} nodeId={batchInput.id} skuPattern={skuPattern} canSubmit={!!workflowId} onSubmit={submit} />
      </aside>

      {/* 右: ジョブと結果 */}
      <section className={`flex-1 min-w-0 min-h-0 flex flex-col ${isMobile ? 'border-t' : ''}`} style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 px-5 shrink-0 border-b" style={{ height: 44, borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
          <h2 className="text-[14px] font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>ジョブと結果</h2>
          {jobs && jobs.length > 0 && (
            <select
              className="ml-2 flex-1 min-w-0 max-w-[520px] h-8 rounded-md px-2 text-[12px] outline-none"
              style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              value={current?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              title="表示するジョブ（この App から投入したもの・新しい順）"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{formatJst(j.created_at)}・{j.name}（{j.item_count} 枚・{statusLabel(j)}）</option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          <button className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} title="ジョブ一覧を読み直す" onClick={() => { setReloadTick((t) => t + 1); bump() }}>
            <ArrowsClockwise size={14} />
          </button>
          <button className="flex items-center gap-1 h-8 px-2.5 rounded-md hover:bg-[var(--bg-elevated)] text-[12px]" style={{ color: 'var(--text-secondary)' }} title="ジョブ管理（すべてのジョブ）" onClick={() => navigate('/jobs')}>
            <ArrowSquareOut size={13} />ジョブ管理
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {jobs === null && !error && (
            <div className="flex items-center justify-center flex-1 gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={16} className="animate-spin" />ジョブを読み込み中…</div>
          )}
          {error && <div className="p-5 text-[12px]" style={{ color: '#EF4444' }}>ジョブを読み込めませんでした: {error}</div>}
          {jobs && jobs.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <div className="font-medium" style={{ color: 'var(--text-primary)' }}>まだジョブがありません</div>
              <div style={{ color: 'var(--text-tertiary)' }}>左で写真を入れて「一括実行…」を押すと、ここにジョブと結果が出ます。</div>
            </div>
          )}
          {current && (
            <JobReviewPanel key={current.id} jobId={current.id} store={store} mode="app" liveCanvas={liveCanvas} onDeleted={() => { setSelectedId(null); setReloadTick((t) => t + 1); bump() }} />
          )}
        </div>
      </section>
    </div>
  )
}
