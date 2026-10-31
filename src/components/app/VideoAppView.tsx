// 商品動画の App モード（2026-10-13）: 左に「カットを入れる」（SKU ごとの役割別の枠）、右に「結果」（履歴から選ぶ）。
// 使う人には「ジョブ」を見せない。保存の単位は batch_jobs のまま（撮影後工程の App と同じ仕組み）
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowSquareOut, CircleNotch, FilmSlate } from '@phosphor-icons/react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useBatchStore, useWatchBatchJobs } from '../../stores/batchStore'
import { useIsMobile } from '../../hooks/useIsMobile'
import { fetchJob, fetchWorkflowJobs } from '../../lib/api/batchJobs'
import { buildWorkflowSnapshot, type CreateItemInput } from '../../lib/api/batch'
import { jobLabel } from '../../lib/batch/jobLabel'
import { totalSeconds } from '../../lib/video/productVideo'
import { inputNodesOf, shotsFromCanvas, type WorkflowSnapshot } from '../../lib/batch/plan'
import type { BatchJobRow } from '../../types/batch'
import { JobActions } from '../jobs/JobActions'
import { AppVideoCutsInput } from './AppVideoCutsInput'
import { VideoReviewPanel } from './VideoReviewPanel'

const ACCENT = '#EC4899'

export function VideoAppView() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const workflowName = useWorkflowStore((s) => s.currentWorkflowName)
  const nodes = useCanvasStore((s) => s.nodes)
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const bump = useBatchStore((s) => s.bump)
  const openSubmitDialogWith = useBatchStore((s) => s.openSubmitDialogWith)
  const userId = useBatchStore((s) => s.userId)
  const memberNames = useBatchStore((s) => s.memberNames)
  useWatchBatchJobs('video-app')

  // 入力ノード = Cut Set Input（旧 Product Video は読み込み時に展開済み。id は <旧 id>:cuts）。構成はキャンバスの配線から（結合のスロット順）
  const edges = useCanvasStore((s) => s.edges)
  const canvas = useMemo<WorkflowSnapshot>(() => ({ nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })), edges: edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null })) }), [nodes, edges])
  const cutSetId = useMemo(() => inputNodesOf(canvas).cutSetInputId, [canvas])
  const shots = useMemo(() => shotsFromCanvas(canvas), [canvas])
  // カードの記憶キーは旧ノード時代と同じ（<旧 id>:cuts → <旧 id>）にして、入れた写真の記憶を引き継ぐ
  const storageNodeId = cutSetId ? cutSetId.replace(/:cuts$/, '') : null

  const [searchParams] = useSearchParams()
  const jobParam = searchParams.get('job')
  const [jobs, setJobs] = useState<BatchJobRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(jobParam)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let alive = true
    ;(workflowId ? fetchWorkflowJobs(workflowId) : Promise.resolve([] as BatchJobRow[]))
      .then(async (rows) => {
        if (jobParam && !rows.some((j) => j.id === jobParam)) {
          const extra = await fetchJob(jobParam).catch(() => null)
          if (extra && extra.workflow_id === workflowId) rows = [extra, ...rows]
        }
        if (!alive) return
        setJobs(rows); setError(null)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [workflowId, jobsVersion, reloadTick, jobParam])
  const current = useMemo(() => (jobs ? jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null : null), [jobs, selectedId])
  const labelOf = useCallback((j: BatchJobRow) => jobLabel(j, j.created_by && j.created_by !== userId ? (memberNames[j.created_by] ?? `${j.created_by.slice(0, 8)}…`) : null), [userId, memberNames])

  const submit = useCallback((items: CreateItemInput[]) => {
    const { nodes: ns, edges } = useCanvasStore.getState()
    openSubmitDialogWith({
      items, snapshot: buildWorkflowSnapshot(ns, edges), workflowId,
      onDone: (jobId) => { setSelectedId(jobId); setReloadTick((t) => t + 1); bump() },   // 入れた写真は残す（ユーザー要望 2026-10-17: 続けて別の構成で作れるように）
    })
  }, [openSubmitDialogWith, workflowId, bump])

  if (!cutSetId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6" style={{ color: 'var(--text-secondary)' }}>
        <div className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>この App には Cut Set Input ノードがありません</div>
        <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>キャンバスで Cut Set Input → Video Generation → Video Merge を組むと、ここでカットの投入と結果の確認ができます。</div>
      </div>
    )
  }

  return (
    <div className={`flex-1 min-h-0 flex ${isMobile ? 'flex-col overflow-auto' : 'flex-row'}`} style={{ background: 'var(--bg-canvas)' }}>
      <aside className={`${isMobile ? 'w-full' : 'w-[400px] shrink-0 overflow-auto border-r'} px-5 py-4`} style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2 mb-1">
          <FilmSlate size={16} style={{ color: ACCENT }} />
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>カットを入れる</h2>
        </div>
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
          SKU ごとに着用カットを役割の枠に入れると、App「{workflowName}」の構成（{shots.length} ショット・約 {totalSeconds(shots)} 秒・無音）で 1 本の動画を作ります。
        </p>
        <AppVideoCutsInput nodeId={cutSetId} shots={shots} canSubmit={!!workflowId && shots.length > 0} onSubmit={submit} storageKey={`${workflowId ?? 'draft'}:${storageNodeId}`} />
      </aside>
      <section className={`flex-1 min-w-0 min-h-0 flex flex-col ${isMobile ? 'border-t' : ''}`} style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 px-5 shrink-0 border-b" style={{ height: 44, borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
          <h2 className="text-[14px] font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>結果</h2>
          {jobs && jobs.length > 0 && (
            <label className="ml-2 flex items-center gap-1.5 flex-1 min-w-0 max-w-[560px] text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              履歴
              <select className="flex-1 min-w-0 h-8 rounded-md px-2 text-[12px] outline-none" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} value={current?.id ?? ''} onChange={(e) => setSelectedId(e.target.value)} title="履歴（この App で処理した分・新しい順）">
                {jobs.map((j) => <option key={j.id} value={j.id}>{labelOf(j)}</option>)}
              </select>
            </label>
          )}
          {current && <JobActions job={current} variant="menu" onChanged={bump} onDeleted={() => { setSelectedId(null); setReloadTick((t) => t + 1); bump() }} />}
          <div className="flex-1" />
          <button className="flex items-center gap-1 h-8 px-2.5 rounded-md hover:bg-[var(--bg-elevated)] text-[12px]" style={{ color: 'var(--text-secondary)' }} title="すべての App の履歴（運用）" onClick={() => navigate('/jobs')}>
            <ArrowSquareOut size={13} />すべての履歴
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {jobs === null && !error && <div className="flex items-center justify-center flex-1 gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={16} className="animate-spin" />結果を読み込み中…</div>}
          {error && <div className="p-5 text-[12px]" style={{ color: '#EF4444' }}>結果を読み込めませんでした: {error}</div>}
          {jobs && jobs.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <div className="font-medium" style={{ color: 'var(--text-primary)' }}>まだ結果がありません</div>
              <div style={{ color: 'var(--text-tertiary)' }}>左で SKU ごとにカットを入れて「…件を処理する」を押すと、ここに結果が出ます。</div>
            </div>
          )}
          {current && <VideoReviewPanel key={current.id} jobId={current.id} onDeleted={() => { setSelectedId(null); setReloadTick((t) => t + 1); bump() }} />}
        </div>
      </section>
    </div>
  )
}
