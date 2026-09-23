import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, CircleNotch, Warning } from '@phosphor-icons/react'
import { useBatchStore } from '../../stores/batchStore'
import { useAuthStore } from '../../stores/authStore'
import { fetchJob, fetchJobItems, reviewItem, subscribeJobItems } from '../../lib/api/batchJobs'
import { signBatchPaths } from '../../lib/cutout/store'
import { jobProgress } from '../../lib/batch/jobsQuery'
import { formatJst } from '../../lib/batch/dates'
import { formatCost } from '../../lib/batch/cost'
import { REVIEW_META, type BatchItemRow, type BatchJobRow, type BatchReview } from '../../types/batch'
import { ItemStatusBadge, JobStatusBadge, ProgressBar, ReviewBadge } from './badges'
import { JobActions } from './JobActions'
import { showToast } from '../../hooks/useToast'

/** 見えている行だけ画像を要求する小さなサムネイル（仕様 4-9: 一覧でフル解像度を同時に持たない） */
function LazyThumb({ url, alt }: { url: string | null; alt: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const obs = new IntersectionObserver((es) => { if (es[0].isIntersecting) setVisible(true) }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [visible])
  return (
    <div ref={ref} className="w-10 h-10 rounded overflow-hidden flex items-center justify-center shrink-0" style={{ background: 'var(--bg-elevated)' }}>
      {visible && url ? <img src={url} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" draggable={false} /> : null}
    </div>
  )
}

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const realtimeOk = useBatchStore((s) => s.realtimeOk)
  const showCost = useBatchStore((s) => s.showCost)
  const memberNames = useBatchStore((s) => s.memberNames)
  const [job, setJob] = useState<BatchJobRow | null>(null)
  const [items, setItems] = useState<BatchItemRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)

  // ジョブ行と（軽いので）アイテムも再取得する。Realtime が無い環境でも定期的な bump で進む
  const loadJob = useCallback(async () => {
    if (!jobId) return
    try {
      const [j, its] = await Promise.all([fetchJob(jobId), fetchJobItems(jobId)])
      if (!j) { setNotFound(true); return }
      setJob(j)
      setItems(its)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [jobId])

  // 初回: ジョブ＋アイテム。以後ジョブ行は Realtime（jobsVersion）で再取得、アイテムは専用の購読で行を更新
  useEffect(() => {
    if (!jobId) return
    let alive = true
    setLoading(true)
    Promise.all([fetchJob(jobId), fetchJobItems(jobId)])
      .then(([j, its]) => { if (!alive) return; if (!j) { setNotFound(true); return } setJob(j); setItems(its) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    if (realtimeOk === false) return () => { alive = false }
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
    })
    return () => { alive = false; unsub() }
  }, [jobId, realtimeOk])
  useEffect(() => { void loadJob() }, [loadJob, jobsVersion])

  // サムネイル: 元画像（ジョブ階層。未コピーなら対話用アップロード）を 1 回の署名で取る
  const pathsKey = items.map((i) => i.source_path ?? i.interactive_path ?? '').filter(Boolean).join('|')
  useEffect(() => {
    const paths = pathsKey ? pathsKey.split('|') : []
    if (!paths.length) return
    let alive = true
    signBatchPaths(paths).then((m) => { if (alive) setThumbs((t) => ({ ...t, ...m })) }).catch(() => {})
    return () => { alive = false }
  }, [pathsKey])

  const summary = useMemo(() => {
    const s = { ready: 0, processing: 0, pending: 0, failed: 0, ok: 0, ng: 0, unreviewed: 0 }
    for (const it of items) {
      if (it.status === 'ready') s.ready++; else if (it.status === 'processing') s.processing++; else if (it.status === 'failed') s.failed++; else s.pending++
      if (it.review === 'ok') s.ok++; else if (it.review === 'ng') s.ng++; else s.unreviewed++
    }
    return s
  }, [items])

  async function setReview(item: BatchItemRow, review: BatchReview) {
    if (reviewing) return
    const next = item.review === review ? 'unreviewed' : review
    setReviewing(item.id)
    const prev = items
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, review: next, reviewed_by: userId } : i)))
    try {
      await reviewItem(item.id, next)
    } catch (e) {
      setItems(prev)
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setReviewing(null)
    }
  }

  const nameOf = (id: string | null) => (id && memberNames[id]) || (id ? `${id.slice(0, 8)}…` : '不明')

  if (loading) {
    return <div className="flex items-center justify-center h-48"><CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} /></div>
  }
  if (notFound || !job) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{error ? `読み込みに失敗しました: ${error}` : 'ジョブが見つかりません（削除されたか、閲覧できないワークスペースのジョブです）'}</p>
        <button onClick={() => navigate('/jobs')} className="px-3 h-8 rounded-lg text-[12px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>ジョブ一覧へ</button>
      </div>
    )
  }
  const p = jobProgress(job)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <button onClick={() => navigate('/jobs')} className="flex items-center gap-1 text-[11px] mb-2 transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-tertiary)' }}>
          <ArrowLeft size={12} />ジョブ一覧
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-[18px] font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={job.name}>{job.name}</h1>
              <JobStatusBadge status={job.status} />
            </div>
            <div className="flex items-center gap-3 mt-2 text-[12px] flex-wrap" style={{ color: 'var(--text-secondary)' }}>
              <span className="flex items-center gap-2">
                <ProgressBar done={p.done} failed={p.failed} total={p.total} width={140} />
                <span className="tabular-nums">{p.total ? `${p.done + p.failed} / ${p.total} タスク` : '投入中'}</span>
              </span>
              {p.failed > 0 && <span className="font-semibold" style={{ color: '#EF4444' }}>失敗 {p.failed}</span>}
              <span>投入者: {nameOf(job.created_by)}</span>
              <span className="tabular-nums">投入 {formatJst(job.created_at)}</span>
              <span className="tabular-nums">更新 {formatJst(job.updated_at)}</span>
              <span className="tabular-nums">{job.item_count} 枚{showCost && <> · 実績 {formatCost(job.actual_cost_usd)}（見積 {formatCost(job.estimated_cost_usd)}）</>}</span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              <span>準備完了 {summary.ready}</span><span>処理中 {summary.processing}</span><span>待機 {summary.pending}</span>
              <span style={{ color: summary.failed ? '#EF4444' : undefined }}>失敗 {summary.failed}</span>
              <span>·</span>
              <span style={{ color: '#22C55E' }}>OK {summary.ok}</span><span style={{ color: summary.ng ? '#EF4444' : undefined }}>NG {summary.ng}</span><span>未確認 {summary.unreviewed}</span>
            </div>
          </div>
          <div className="shrink-0"><JobActions job={job} onDeleted={() => navigate('/jobs')} /></div>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-auto px-8 py-5">
        <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-[12px]" style={{ tableLayout: 'fixed', minWidth: 720 }}>
            <colgroup><col style={{ width: 36 }} /><col style={{ width: 52 }} /><col style={{ width: 120 }} /><col style={{ minWidth: 120 }} /><col style={{ width: 84 }} /><col style={{ width: 84 }} /><col style={{ width: 44 }} /><col style={{ width: 176 }} /></colgroup>
            <thead>
              <tr style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                {['#', '', 'SKU', 'ファイル名', 'サイズ', '状態', '警告', '確認'].map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const path = it.source_path ?? it.interactive_path
                return (
                  <tr key={it.id} style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
                    <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{it.sort_order}</td>
                    <td className="px-2 py-1.5"><LazyThumb url={path ? thumbs[path] ?? null : null} alt="" /></td>
                    <td className="px-3 py-1.5 font-medium truncate" style={{ color: 'var(--text-primary)' }} title={it.sku}>{it.sku}</td>
                    <td className="px-3 py-1.5 truncate" style={{ color: 'var(--text-secondary)' }} title={it.original_filename}>{it.original_filename}</td>
                    <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{it.width && it.height ? `${it.width}×${it.height}` : '—'}</td>
                    <td className="px-3 py-1.5"><ItemStatusBadge status={it.status} /></td>
                    <td className="px-3 py-1.5">
                      {it.warnings.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.14)' }} title={it.warnings.join('\n')}>
                          <Warning size={11} weight="fill" />{it.warnings.length}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        {(['ok', 'ng'] as BatchReview[]).map((r) => {
                          const on = it.review === r
                          const m = REVIEW_META[r]
                          return (
                            <button
                              key={r}
                              disabled={reviewing === it.id}
                              onClick={() => void setReview(it, r)}
                              className="h-6 px-2 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-60"
                              style={{ color: on ? '#fff' : m.color, background: on ? m.color : m.bg, border: `1px solid ${on ? m.color : 'transparent'}` }}
                              title={on ? `${m.label} を取り消す` : `${m.label} にする`}
                            >
                              {m.label}
                            </button>
                          )
                        })}
                        {it.review === 'unreviewed' ? <ReviewBadge review="unreviewed" /> : (
                          <span className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }} title={it.reviewed_by ? nameOf(it.reviewed_by) : ''}>
                            {it.reviewed_by ? nameOf(it.reviewed_by) : ''}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center" style={{ color: 'var(--text-tertiary)' }}>アイテムがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          OK / NG は同じボタンをもう一度押すと取り消せます。他のメンバーの判定と処理の進み具合は自動で反映されます。レイアウトの確認グリッド（拡大・書き出し）は次のステップで追加します。
        </p>
      </div>
    </div>
  )
}
