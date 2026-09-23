import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowsClockwise, CaretLeft, CaretRight, CircleNotch, MagnifyingGlass, X } from '@phosphor-icons/react'
import { useBatchStore } from '../../stores/batchStore'
import { fetchFinishedJobs, fetchReviewCounts, fetchSkuJobIds } from '../../lib/api/batchJobs'
import {
  DEFAULT_JOB_FILTERS, JOBS_PAGE_SIZE, jobProgress, matchesFilters, mergeJobRows, normalizeSearch, pageCount, type JobFilters, type JobStatusFilter,
} from '../../lib/batch/jobsQuery'
import { formatJst } from '../../lib/batch/dates'
import { formatCost } from '../../lib/batch/cost'
import { JOB_STATUS_META, type BatchJobRow, type BatchJobStatus, type ReviewCounts } from '../../types/batch'
import { JobStatusBadge, ProgressBar } from './badges'
import { JobActions } from './JobActions'

const STATUS_OPTIONS: Array<[JobStatusFilter, string]> = [
  ['all', '状態: すべて'], ['active', '進行中'], ['completed', '完了'], ['partial_failed', '一部失敗'], ['cancelled', 'キャンセル済み'],
]

const SELECT = 'text-[12px] rounded-lg px-2 h-8 outline-none'
const SELECT_STYLE = { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' } as const

function shortId(id: string | null): string {
  return id ? `${id.slice(0, 8)}…` : '不明'
}

export function JobsPage() {
  const navigate = useNavigate()
  const teamId = useBatchStore((s) => s.teamId)
  const ready = useBatchStore((s) => s.ready)
  const activeJobs = useBatchStore((s) => s.activeJobs)
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const usedToday = useBatchStore((s) => s.usedToday)
  const dailyLimit = useBatchStore((s) => s.dailyLimit)
  const showCost = useBatchStore((s) => s.showCost)
  const memberNames = useBatchStore((s) => s.memberNames)
  const bump = useBatchStore((s) => s.bump)
  const realtimeOk = useBatchStore((s) => s.realtimeOk)

  const [filters, setFilters] = useState<JobFilters>(DEFAULT_JOB_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [finished, setFinished] = useState<BatchJobRow[]>([])
  const [total, setTotal] = useState(0)
  const [skuJobIds, setSkuJobIds] = useState<Set<string> | null>(null)
  const [reviewCounts, setReviewCounts] = useState<Record<string, ReviewCounts>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqSeq = useRef(0)

  // 検索欄は 300ms 待ってから絞り込みに反映
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  const setFilter = useCallback(<K extends keyof JobFilters>(k: K, v: JobFilters[K]) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1) }, [])

  const load = useCallback(async () => {
    if (!teamId) return
    const seq = ++reqSeq.current
    setRefreshing(true)
    try {
      const search = normalizeSearch(filters.search)
      const ids = search ? await fetchSkuJobIds(teamId, search) : []
      const res = await fetchFinishedJobs(teamId, filters, page, ids)
      if (seq !== reqSeq.current) return
      setSkuJobIds(search ? new Set(ids) : null)
      setFinished(res.rows)
      setTotal(res.total)
      setError(null)
      const active = useBatchStore.getState().activeJobs
      const counts = await fetchReviewCounts([...active.map((j) => j.id), ...res.rows.map((j) => j.id)])
      if (seq === reqSeq.current) setReviewCounts(counts)
    } catch (e) {
      if (seq === reqSeq.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === reqSeq.current) { setLoading(false); setRefreshing(false) }
    }
  }, [teamId, filters, page])

  // 初回・絞り込み・ページ・Realtime（jobsVersion）で再取得
  useEffect(() => { void load() }, [load, jobsVersion])
  // 一覧を開いている間は定期的に再取得（他メンバーの削除など Realtime で拾えない変更の保険。Realtime 無しなら 20 秒ごと）
  useEffect(() => { const t = setInterval(() => bump(), realtimeOk === false ? 20_000 : 60_000); return () => clearInterval(t) }, [bump, realtimeOk])

  const visibleActive = useMemo(() => activeJobs.filter((j) => matchesFilters(j, filters, skuJobIds)), [activeJobs, filters, skuJobIds])
  const pages = pageCount(total)
  const creatorOptions = useMemo(() => {
    const map = new Map<string, string>(Object.entries(memberNames))
    for (const j of [...activeJobs, ...finished]) if (j.created_by && !map.has(j.created_by)) map.set(j.created_by, shortId(j.created_by))
    return Array.from(map.entries())
  }, [memberNames, activeJobs, finished])
  const hasFilter = filters.status !== 'all' || filters.createdBy !== 'all' || !!filters.from || !!filters.to || !!normalizeSearch(filters.search)
  const nameOf = (id: string | null) => (id && memberNames[id]) || shortId(id)

  // 進行中（ストア）と終了済み（このページの取得）は更新のタイミングが違うため、切り替わりの瞬間の重複を除く
  const rows = mergeJobRows(visibleActive, finished)

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-8 py-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>Jobs</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>一括実行のジョブ（チームのメンバー全員分）</p>
        </div>
        <div className="flex items-center gap-4 shrink-0 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <span title="本日（日本時間）に投入した枚数と、ワークスペースの 1 日の上限">
            本日 <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{usedToday}</b> / {dailyLimit} 枚
          </span>
          <span title="同時に進行できるジョブは 2 つまで">
            進行中 <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{activeJobs.length}</b> / 2
          </span>
          <button
            onClick={() => bump()}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-elevated)]"
            style={{ color: 'var(--text-secondary)' }}
            title="再読み込み"
          >
            {refreshing ? <CircleNotch size={14} className="animate-spin" /> : <ArrowsClockwise size={14} />}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-8 py-3 border-b shrink-0 flex-wrap" style={{ borderColor: 'var(--border)' }}>
        <div className="relative">
          <MagnifyingGlass size={13} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ジョブ名 / SKU で検索"
            className={`${SELECT} pl-7 w-[240px]`}
            style={{ ...SELECT_STYLE, color: 'var(--text-primary)' }}
          />
        </div>
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value as JobStatusFilter)} className={SELECT} style={SELECT_STYLE}>
          {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.createdBy} onChange={(e) => setFilter('createdBy', e.target.value)} className={SELECT} style={SELECT_STYLE} title="投入者で絞り込み">
          <option value="all">投入者: 全員</option>
          {creatorOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          期間
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className={SELECT} style={SELECT_STYLE} />
          〜
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className={SELECT} style={SELECT_STYLE} />
        </label>
        {hasFilter && (
          <button
            onClick={() => { setFilters(DEFAULT_JOB_FILTERS); setSearchInput(''); setPage(1) }}
            className="flex items-center gap-1 h-8 px-2 rounded-lg text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={12} />条件をクリア
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-5">
        {!ready || loading ? (
          <div className="flex items-center justify-center h-48">
            <CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-[13px]" style={{ color: 'var(--error)' }}>読み込みに失敗しました: {error}</p>
            <button onClick={() => void load()} className="px-3 h-8 rounded-lg text-[12px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>再読み込み</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>{hasFilter ? '条件に一致するジョブがありません' : 'まだジョブがありません'}</p>
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              {hasFilter ? '絞り込みや検索語を変えてみてください' : 'キャンバスの Batch Input ノードから「一括実行」すると、ここに表示されます'}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-[12px]" style={{ tableLayout: 'fixed', minWidth: showCost ? 1180 : 1080 }}>
                <colgroup>
                  <col style={{ minWidth: 160 }} /><col style={{ width: 140 }} /><col style={{ width: 112 }} /><col style={{ width: 104 }} /><col style={{ width: 160 }} />
                  <col style={{ width: 48 }} /><col style={{ width: 124 }} /><col style={{ width: showCost ? 170 : 72 }} /><col style={{ width: 112 }} /><col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                    {['ジョブ名', '投入者', '投入日時', '状態', '進捗', '失敗', '確認状況', '利用量', '最終更新', ''].map((h, i) => (
                      <th key={i} className={`font-medium px-3 py-2 whitespace-nowrap ${i === 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ job, active }, idx) => {
                    const p = jobProgress(job)
                    const rc = reviewCounts[job.id]
                    const firstFinished = !active && idx > 0 && rows[idx - 1].active
                    return (
                      <tr
                        key={job.id}
                        onClick={() => navigate(`/jobs/${job.id}`)}
                        className="cursor-pointer transition-colors hover:bg-[var(--bg-elevated)]"
                        style={{
                          borderTop: firstFinished ? '2px solid var(--border-active)' : '1px solid var(--border)',
                          background: active ? 'rgba(99,102,241,0.04)' : 'var(--bg-panel)',
                        }}
                      >
                        <td className="px-3 py-2 truncate font-medium" style={{ color: 'var(--text-primary)' }} title={job.name}>{job.name}</td>
                        <td className="px-3 py-2 truncate" style={{ color: 'var(--text-secondary)' }} title={nameOf(job.created_by)}>{nameOf(job.created_by)}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatJst(job.created_at)}</td>
                        <td className="px-3 py-2"><JobStatusBadge status={job.status as BatchJobStatus} /></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <ProgressBar done={p.done} failed={p.failed} total={p.total} />
                            <span className="tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                              {p.total ? `${p.done + p.failed} / ${p.total}` : job.status === 'uploading' ? '投入中' : '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.failed > 0
                            ? <span className="inline-flex px-1.5 py-0.5 rounded font-semibold" style={{ color: '#EF4444', background: 'rgba(239,68,68,0.14)' }}>{p.failed}</span>
                            : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {rc ? <><span style={{ color: '#22C55E' }}>OK {rc.ok}</span> · <span style={{ color: rc.ng ? '#EF4444' : undefined }}>NG {rc.ng}</span> · 未 {rc.unreviewed}</> : '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {job.item_count} 枚{showCost && <span className="ml-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{formatCost(job.actual_cost_usd)}</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>{formatJst(job.updated_at)}</td>
                        <td className="px-2 py-1.5"><JobActions job={job} showOpen compact /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* 進行中は全件固定・その下を 20 件ごとにページ送り */}
            <div className="flex items-center justify-between mt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              <span>
                {visibleActive.length > 0 && <>進行中 {visibleActive.length} 件 · </>}
                終了済み {total} 件{total > 0 && <>（{(page - 1) * JOBS_PAGE_SIZE + 1}–{Math.min(total, page * JOBS_PAGE_SIZE)}）</>}
              </span>
              {pages > 1 && (
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] disabled:opacity-40" style={{ color: 'var(--text-secondary)' }} title="前へ"><CaretLeft size={13} /></button>
                  <span className="tabular-nums px-1">{page} / {pages}</span>
                  <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] disabled:opacity-40" style={{ color: 'var(--text-secondary)' }} title="次へ"><CaretRight size={13} /></button>
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              状態の色: {(['processing', 'completed', 'partial_failed', 'cancelled'] as BatchJobStatus[]).map((s) => JOB_STATUS_META[s].label).join(' / ')}。
              {realtimeOk === false ? 'リアルタイム接続ができないため、20 秒ごとに再取得しています。' : '進捗と状態は自動で更新されます。'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
