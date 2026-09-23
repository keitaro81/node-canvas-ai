// ジョブ管理（仕様 4-11）の読み取り・確認結果・Realtime。読み取りは RLS（所属チーム）で Supabase から直接引く。
// 書き込みは Edge（src/lib/api/batch.ts）経由。ここで直接書くのは確認結果の RPC だけ（仕様 4-3 アクセス制御）。
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { jstDayBounds, jstDayRangeUtc } from '../batch/dates'
import { JOBS_PAGE_SIZE, normalizeSearch, quoteOrValue, sumUsedToday, type JobFilters } from '../batch/jobsQuery'
import {
  ACTIVE_JOB_STATUSES, ITEM_COLUMNS, JOB_COLUMNS, JOB_DETAIL_COLUMNS, OUTPUT_COLUMNS, TASK_COLUMNS,
  type BatchItemRow, type BatchJobDetail, type BatchJobRow, type BatchOutputRow, type BatchReview, type BatchTaskRow, type ReviewCounts,
} from '../../types/batch'
import { aggregateReviewCounts } from '../batch/jobsQuery'
import { getWorkflow, updateWorkflow } from './workflows'
import type { Json } from '../../types/database'

// 手書きの Database 型は batch_* を持たない（列指定 select が never に潰れる）ため、既存の teams.ts と同じく untyped で引き、結果側で型を付ける
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any

const ACTIVE_LIST = `(${ACTIVE_JOB_STATUSES.join(',')})`

function asJobs(rows: unknown): BatchJobRow[] {
  return (Array.isArray(rows) ? rows : []) as BatchJobRow[]
}

function asItems(rows: unknown): BatchItemRow[] {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const row = r as BatchItemRow & { warnings: unknown }
    return { ...row, warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [] }
  })
}

export interface TeamBatchSettings { dailyLimit: number; showCost: boolean }

export async function fetchTeamBatchSettings(teamId: string): Promise<TeamBatchSettings> {
  const { data } = await sb.from('teams').select('daily_item_limit, show_cost').eq('id', teamId).maybeSingle() as { data: { daily_item_limit?: number; show_cost?: boolean } | null }
  return { dailyLimit: typeof data?.daily_item_limit === 'number' ? data.daily_item_limit : 300, showCost: !!data?.show_cost }
}

/** 本日（JST）の利用枚数（サーバーの checkLimits と同じ規則） */
export async function fetchUsedToday(teamId: string): Promise<number> {
  const { start, end } = jstDayRangeUtc()
  const { data } = await sb.from('batch_jobs').select('item_count, status').eq('team_id', teamId).gte('created_at', start).lt('created_at', end)
  return sumUsedToday((data ?? []) as Array<{ item_count: number; status: string }>)
}

export async function fetchActiveJobs(teamId: string): Promise<BatchJobRow[]> {
  const { data, error } = await sb.from('batch_jobs').select(JOB_COLUMNS).eq('team_id', teamId).in('status', ACTIVE_JOB_STATUSES).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return asJobs(data)
}

/** SKU の部分一致で該当するジョブ ID（数千件でも team_id+sku 索引で軽い） */
export async function fetchSkuJobIds(teamId: string, search: string): Promise<string[]> {
  const q = normalizeSearch(search)
  if (!q) return []
  const { data } = await sb.from('batch_items').select('job_id').eq('team_id', teamId).ilike('sku', `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`).limit(2000)
  return Array.from(new Set(((data ?? []) as Array<{ job_id: string }>).map((r) => r.job_id)))
}

export interface FinishedJobsPage { rows: BatchJobRow[]; total: number }

/** 終了済みジョブ（新しい順・20 件ページ）。検索は「ジョブ名 or SKU 一致ジョブ」 */
export async function fetchFinishedJobs(teamId: string, f: JobFilters, page: number, skuJobIds: string[]): Promise<FinishedJobsPage> {
  if (f.status === 'active') return { rows: [], total: 0 }
  let q = sb.from('batch_jobs').select(JOB_COLUMNS, { count: 'exact' }).eq('team_id', teamId)
  q = f.status === 'all' ? q.not('status', 'in', ACTIVE_LIST) : q.eq('status', f.status)
  if (f.createdBy !== 'all') q = q.eq('created_by', f.createdBy)
  const from = f.from ? jstDayBounds(f.from) : null
  const to = f.to ? jstDayBounds(f.to) : null
  if (from) q = q.gte('created_at', from.start)
  if (to) q = q.lt('created_at', to.end)
  const search = normalizeSearch(f.search)
  if (search) {
    const name = `name.ilike.${quoteOrValue(`%${search}%`)}`
    q = skuJobIds.length ? q.or(`${name},id.in.(${skuJobIds.join(',')})`) : q.or(name)
  }
  const fromIdx = Math.max(0, page - 1) * JOBS_PAGE_SIZE
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(fromIdx, fromIdx + JOBS_PAGE_SIZE - 1)
  if (error) throw new Error(error.message)
  return { rows: asJobs(data), total: count ?? 0 }
}

export async function fetchJob(jobId: string): Promise<BatchJobRow | null> {
  const { data, error } = await sb.from('batch_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as BatchJobRow | null) ?? null
}

/** ジョブ詳細（写し・上書き設定・投入元ワークフローつき）。ReviewGrid 用 */
export async function fetchJobDetail(jobId: string): Promise<BatchJobDetail | null> {
  const { data, error } = await sb.from('batch_jobs').select(JOB_DETAIL_COLUMNS).eq('id', jobId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as BatchJobDetail
  return { ...row, workflow_snapshot: row.workflow_snapshot ?? {}, layout_overrides: row.layout_overrides && typeof row.layout_overrides === 'object' ? row.layout_overrides : {}, workflow_id: row.workflow_id ?? null }
}

/** 投入元ワークフローの現在の内容（RLS: 本人か、チーム共有のものだけ読める。読めなければ null） */
export interface WorkflowSource { id: string; projectId: string; name: string; canvas: Record<string, unknown>; updatedAt: string }
export async function fetchWorkflowSource(workflowId: string): Promise<WorkflowSource | null> {
  try {
    const w = await getWorkflow(workflowId)
    const canvas = w.canvas_data && typeof w.canvas_data === 'object' && !Array.isArray(w.canvas_data) ? (w.canvas_data as Record<string, unknown>) : {}
    return { id: w.id, projectId: w.project_id, name: w.name, canvas, updatedAt: w.updated_at }
  } catch {
    return null
  }
}

/** 投入元ワークフローの canvas_data を保存する（本人のワークフローだけ RLS で通る） */
export async function saveWorkflowCanvas(workflowId: string, canvas: Record<string, unknown>): Promise<void> {
  await updateWorkflow(workflowId, { canvas_data: canvas as unknown as Json })
}

/** ジョブのタスク（結果ファイルのパスと付帯情報） */
export async function fetchJobTasks(jobId: string): Promise<BatchTaskRow[]> {
  const { data, error } = await sb.from('batch_tasks').select(TASK_COLUMNS).eq('job_id', jobId)
  if (error) throw new Error(error.message)
  return ((data ?? []) as BatchTaskRow[]).map((t) => ({ ...t, input: t.input && typeof t.input === 'object' ? t.input : {} }))
}

/** 記録済みのサムネイル（kind='thumb'）。識別値が同じなら描き直さない */
export async function fetchJobThumbs(itemIds: string[]): Promise<BatchOutputRow[]> {
  if (!itemIds.length) return []
  const { data, error } = await sb.from('batch_outputs').select(OUTPUT_COLUMNS).eq('kind', 'thumb').in('item_id', itemIds)
  if (error) throw new Error(error.message)
  return (data ?? []) as BatchOutputRow[]
}

/** サムネイルの記録（RPC record_batch_output・所属チェックとパス検査つき） */
export async function recordThumb(itemId: string, variant: string, layoutHash: string, outputPath: string): Promise<void> {
  const { error } = await sb.rpc('record_batch_output', { p_item_id: itemId, p_variant: variant, p_layout_hash: layoutHash, p_output_path: outputPath, p_kind: 'thumb' })
  if (error) throw new Error(error.message)
}

/** ジョブ画面で変更したバリアント設定の保存（RPC set_batch_job_layout・メンバーなら誰でも） */
export async function setJobLayoutOverrides(jobId: string, overrides: Record<string, unknown>): Promise<void> {
  const { error } = await sb.rpc('set_batch_job_layout', { p_job_id: jobId, p_overrides: overrides })
  if (error) throw new Error(error.message)
}

export async function fetchJobItems(jobId: string): Promise<BatchItemRow[]> {
  const { data, error } = await sb.from('batch_items').select(ITEM_COLUMNS).eq('job_id', jobId).order('sort_order')
  if (error) throw new Error(error.message)
  return asItems(data)
}

/** 一覧表示時に集計する（仕様 4-11: リアルタイム更新は不要） */
export async function fetchReviewCounts(jobIds: string[]): Promise<Record<string, ReviewCounts>> {
  if (!jobIds.length) return {}
  const { data } = await sb.from('batch_items').select('job_id, review').in('job_id', jobIds)
  return aggregateReviewCounts((data ?? []) as Array<{ job_id: string; review: string }>)
}

/** OK / NG / 未確認（RPC review_batch_item: 所属チェック付き・確認者 = 本人） */
export async function reviewItem(itemId: string, review: BatchReview): Promise<void> {
  const { error } = await sb.rpc('review_batch_item', { p_item_id: itemId, p_review: review })
  if (error) throw new Error(error.message)
}

// ───────────────────────── Realtime（RLS が購読にも効く） ─────────────────────────

let channelSeq = 0

export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'

/** 自チームの batch_jobs の変更（INSERT/UPDATE/DELETE）。DELETE は行の中身を持たないため呼び出し側は再取得で反映する */
export function subscribeTeamJobs(
  teamId: string,
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
  onStatus?: (status: ChannelStatus, err?: Error) => void,
): () => void {
  const ch: RealtimeChannel = supabase
    .channel(`batch-jobs:${teamId}:${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_jobs', filter: `team_id=eq.${teamId}` }, onChange)
    .subscribe((status, err) => onStatus?.(status as ChannelStatus, err))
  return () => { void supabase.removeChannel(ch) }
}

/** Realtime を諦める: 再接続ループを止める（次に subscribe すれば自動で再接続を試みる） */
export function disconnectRealtime(): void {
  try { supabase.realtime.disconnect() } catch { /* 未接続なら何もしない */ }
}

/** 1 ジョブの batch_items の更新（状態・確認結果）。詳細画面を開いている間だけ購読する */
export function subscribeJobItems(jobId: string, onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void): () => void {
  const ch: RealtimeChannel = supabase
    .channel(`batch-items:${jobId}:${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batch_items', filter: `job_id=eq.${jobId}` }, onChange)
    .subscribe()
  return () => { void supabase.removeChannel(ch) }
}
