import { CircleNotch } from '@phosphor-icons/react'
import { ITEM_STATUS_META, JOB_STATUS_META, REVIEW_META, type BatchItemDbStatus, type BatchJobStatus, type BatchReview } from '../../types/batch'

export function JobStatusBadge({ status }: { status: BatchJobStatus }) {
  const m = JOB_STATUS_META[status] ?? JOB_STATUS_META.processing
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap" style={{ color: m.color, background: m.bg }}>
      {m.active && <CircleNotch size={11} className="animate-spin" />}
      {m.label}
    </span>
  )
}

export function ItemStatusBadge({ status }: { status: BatchItemDbStatus }) {
  const m = ITEM_STATUS_META[status] ?? ITEM_STATUS_META.pending
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap" style={{ color: m.color }}>
      {status === 'processing' && <CircleNotch size={11} className="animate-spin" />}
      {m.label}
    </span>
  )
}

export function ReviewBadge({ review }: { review: BatchReview }) {
  const m = REVIEW_META[review] ?? REVIEW_META.unreviewed
  return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ color: m.color, background: m.bg }}>{m.label}</span>
}

/** 進捗バー: 完了（緑）＋失敗（赤）。total=0 は投入中の扱い */
export function ProgressBar({ done, failed, total, width = 96 }: { done: number; failed: number; total: number; width?: number }) {
  const donePct = total ? Math.min(100, (done / total) * 100) : 0
  const failPct = total ? Math.min(100 - donePct, (failed / total) * 100) : 0
  return (
    <div className="h-1.5 rounded overflow-hidden flex" style={{ width, background: 'var(--bg-elevated)' }} aria-hidden>
      <div style={{ width: `${donePct}%`, background: '#22C55E', transition: 'width 300ms ease-out' }} />
      <div style={{ width: `${failPct}%`, background: '#EF4444', transition: 'width 300ms ease-out' }} />
    </div>
  )
}
