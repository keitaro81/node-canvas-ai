// ジョブ管理画面（仕様 4-11）の純関数: 絞り込み・権限・進捗・集計。UI からもテストからも使う。
import type { BatchJobRow, BatchJobStatus, ReviewCounts } from '../../types/batch'
import { ACTIVE_JOB_STATUSES } from '../../types/batch'

export const JOBS_PAGE_SIZE = 20

export type JobStatusFilter = 'all' | 'active' | BatchJobStatus

export interface JobFilters {
  status: JobStatusFilter
  createdBy: string        // 'all' | userId
  from: string             // 'YYYY-MM-DD' | ''
  to: string               // 'YYYY-MM-DD' | ''
  search: string           // ジョブ名 or SKU
}

export const DEFAULT_JOB_FILTERS: JobFilters = { status: 'all', createdBy: 'all', from: '', to: '', search: '' }

export function isActiveJob(job: Pick<BatchJobRow, 'status'>): boolean {
  return ACTIVE_JOB_STATUSES.includes(job.status)
}

/** 進捗（完了タスク / タスク総数）。投入中でタスク未確定なら total=0 */
export function jobProgress(job: Pick<BatchJobRow, 'completed_tasks' | 'failed_tasks' | 'task_count'>): { done: number; failed: number; total: number; pct: number } {
  const total = Math.max(0, job.task_count ?? 0)
  const done = Math.max(0, job.completed_tasks ?? 0)
  const failed = Math.max(0, job.failed_tasks ?? 0)
  const pct = total > 0 ? Math.min(100, Math.round(((done + failed) / total) * 100)) : 0
  return { done, failed, total, pct }
}

/** 削除は投入者本人と owner だけ（仕様 4-11 権限表） */
export function canDeleteJob(job: Pick<BatchJobRow, 'created_by'>, userId: string | null | undefined, role: string | null | undefined): boolean {
  if (!userId) return false
  return job.created_by === userId || role === 'owner'
}

export function canCancelJob(job: Pick<BatchJobRow, 'status'>): boolean {
  return isActiveJob(job)
}

/** 失敗分の再実行: 一部失敗、または進行中で失敗タスクがあるもの */
export function canRetryJob(job: Pick<BatchJobRow, 'status' | 'failed_tasks'>): boolean {
  if (job.status === 'partial_failed') return true
  return (job.status === 'processing' || job.status === 'submitted') && (job.failed_tasks ?? 0) > 0
}

/**
 * 再開の対象: 自分が投入したまま途中で閉じたジョブ（uploading）。
 * 投入中のブラウザは投入のたびに updated_at を進めるので、staleMs 以上動きが無いものだけ再開する（二重投入の回避）。
 */
export function isResumableJob(job: Pick<BatchJobRow, 'status' | 'created_by' | 'updated_at'>, userId: string, nowMs: number, staleMs = 60_000): boolean {
  if (job.status !== 'uploading' || job.created_by !== userId) return false
  const t = new Date(job.updated_at).getTime()
  return !Number.isFinite(t) || nowMs - t >= staleMs
}

/** PostgREST の or() に埋め込む値（二重引用符で囲む。引用符と改行は除く） */
export function quoteOrValue(s: string): string {
  return `"${s.replace(/["\\\r\n]/g, ' ')}"`
}

export function normalizeSearch(s: string): string {
  return s.trim().replace(/\s+/g, ' ').slice(0, 100)
}

/** 進行中セクション（小さい・全件保持）への絞り込み。SKU 一致はサーバーで引いた jobId 集合で判定 */
export function matchesFilters(job: BatchJobRow, f: JobFilters, skuJobIds: Set<string> | null): boolean {
  if (f.status !== 'all' && f.status !== 'active' && job.status !== f.status) return false
  if (f.createdBy !== 'all' && job.created_by !== f.createdBy) return false
  const created = new Date(job.created_at).getTime()
  if (f.from) { const t = new Date(`${f.from}T00:00:00+09:00`).getTime(); if (Number.isFinite(t) && created < t) return false }
  if (f.to) { const t = new Date(`${f.to}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000; if (Number.isFinite(t) && created >= t) return false }
  const q = normalizeSearch(f.search).toLowerCase()
  if (q) {
    const nameHit = job.name.toLowerCase().includes(q)
    const skuHit = skuJobIds?.has(job.id) ?? false
    if (!nameHit && !skuHit) return false
  }
  return true
}

export function aggregateReviewCounts(rows: Array<{ job_id: string; review: string }>): Record<string, ReviewCounts> {
  const out: Record<string, ReviewCounts> = {}
  for (const r of rows) {
    const c = (out[r.job_id] = out[r.job_id] ?? { ok: 0, ng: 0, unreviewed: 0 })
    if (r.review === 'ok') c.ok++
    else if (r.review === 'ng') c.ng++
    else c.unreviewed++
  }
  return out
}

/** 本日の利用枚数（キャンセル済みは数えない。サーバー batchCreate と同じ規則） */
export function sumUsedToday(jobs: Array<{ item_count: number; status: string }>): number {
  return jobs.filter((j) => j.status !== 'cancelled').reduce((s, j) => s + (j.item_count ?? 0), 0)
}

/**
 * 一覧の行 = 進行中（ストア）＋終了済み（ページの取得）。両者は別々のタイミングで更新されるため、
 * 状態が切り替わる瞬間に同じジョブが両方に現れうる。進行中側を優先して重複を除く（同じ key が 2 つ並ばない）。
 */
export function mergeJobRows(active: BatchJobRow[], finished: BatchJobRow[]): Array<{ job: BatchJobRow; active: boolean }> {
  const seen = new Set<string>()
  const out: Array<{ job: BatchJobRow; active: boolean }> = []
  for (const job of active) { if (!seen.has(job.id)) { seen.add(job.id); out.push({ job, active: true }) } }
  for (const job of finished) { if (!seen.has(job.id)) { seen.add(job.id); out.push({ job, active: false }) } }
  return out
}

export function pageCount(total: number, pageSize = JOBS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
