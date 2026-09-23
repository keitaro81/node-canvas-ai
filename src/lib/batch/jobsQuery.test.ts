import { describe, it, expect } from 'vitest'
import {
  aggregateReviewCounts, canDeleteJob, canRetryJob, isResumableJob, jobProgress, matchesFilters, mergeJobRows, pageCount, quoteOrValue, sumUsedToday, DEFAULT_JOB_FILTERS,
} from './jobsQuery'
import { jstDayBounds, jstDayRangeUtc } from './dates'
import { formatCost, formatDuration } from './cost'
import type { BatchJobRow } from '../../types/batch'

const job = (over: Partial<BatchJobRow> = {}): BatchJobRow => ({
  id: 'j1', team_id: 't', created_by: 'u1', name: '2026-09-23 10:00 20枚', status: 'processing',
  item_count: 20, task_count: 20, completed_tasks: 5, failed_tasks: 1, estimated_cost_usd: 0.02, actual_cost_usd: 0.01,
  created_at: '2026-09-23T01:00:00.000Z', updated_at: '2026-09-23T01:00:00.000Z', ...over,
})

describe('jobsQuery（一覧の純関数）', () => {
  it('進捗は (完了+失敗)/総数', () => {
    expect(jobProgress(job())).toEqual({ done: 5, failed: 1, total: 20, pct: 30 })
    expect(jobProgress(job({ task_count: 0, completed_tasks: 0, failed_tasks: 0 })).pct).toBe(0)
  })
  it('削除は投入者本人か owner', () => {
    expect(canDeleteJob(job(), 'u1', 'member')).toBe(true)
    expect(canDeleteJob(job(), 'u2', 'member')).toBe(false)
    expect(canDeleteJob(job(), 'u2', 'owner')).toBe(true)
    expect(canDeleteJob(job(), null, 'owner')).toBe(false)
  })
  it('再実行は一部失敗、または進行中で失敗あり', () => {
    expect(canRetryJob(job({ status: 'partial_failed', failed_tasks: 2 }))).toBe(true)
    expect(canRetryJob(job({ status: 'processing', failed_tasks: 1 }))).toBe(true)
    expect(canRetryJob(job({ status: 'processing', failed_tasks: 0 }))).toBe(false)
    expect(canRetryJob(job({ status: 'completed', failed_tasks: 0 }))).toBe(false)
    expect(canRetryJob(job({ status: 'cancelled', failed_tasks: 3 }))).toBe(false)
  })
  it('再開は自分の uploading で 60 秒以上動きが無いもの', () => {
    const now = Date.parse('2026-09-23T01:02:00.000Z')
    expect(isResumableJob(job({ status: 'uploading' }), 'u1', now)).toBe(true)
    expect(isResumableJob(job({ status: 'uploading', updated_at: '2026-09-23T01:01:30.000Z' }), 'u1', now)).toBe(false)
    expect(isResumableJob(job({ status: 'uploading' }), 'u2', now)).toBe(false)
    expect(isResumableJob(job({ status: 'processing' }), 'u1', now)).toBe(false)
  })
  it('絞り込み: 状態・投入者・期間（JST）・検索（名前 or SKU 一致集合）', () => {
    const f = { ...DEFAULT_JOB_FILTERS }
    expect(matchesFilters(job(), f, null)).toBe(true)
    expect(matchesFilters(job(), { ...f, status: 'completed' }, null)).toBe(false)
    expect(matchesFilters(job(), { ...f, status: 'active' }, null)).toBe(true)
    expect(matchesFilters(job(), { ...f, createdBy: 'u2' }, null)).toBe(false)
    expect(matchesFilters(job(), { ...f, from: '2026-09-23' }, null)).toBe(true)     // 01:00Z = JST 10:00
    expect(matchesFilters(job(), { ...f, from: '2026-09-24' }, null)).toBe(false)
    expect(matchesFilters(job(), { ...f, to: '2026-09-22' }, null)).toBe(false)
    expect(matchesFilters(job(), { ...f, to: '2026-09-23' }, null)).toBe(true)
    expect(matchesFilters(job(), { ...f, search: '20枚' }, null)).toBe(true)
    expect(matchesFilters(job(), { ...f, search: 'SKU-001' }, null)).toBe(false)
    expect(matchesFilters(job(), { ...f, search: 'SKU-001' }, new Set(['j1']))).toBe(true)
  })
  it('or() の値は引用符で囲み、引用符は落とす', () => {
    expect(quoteOrValue('a"b,c')).toBe('"a b,c"')
  })
  it('進行中と終了済みの結合は重複を除き、進行中を上に固定する', () => {
    const a = job({ id: 'x', status: 'processing' }), b = job({ id: 'y', status: 'completed' }), stale = job({ id: 'x', status: 'partial_failed' })
    expect(mergeJobRows([a], [stale, b]).map((r) => `${r.job.id}:${r.active}`)).toEqual(['x:true', 'y:false'])
    expect(mergeJobRows([], [b]).map((r) => r.active)).toEqual([false])
  })
  it('確認状況の集計と本日の利用枚数', () => {
    expect(aggregateReviewCounts([{ job_id: 'a', review: 'ok' }, { job_id: 'a', review: 'ng' }, { job_id: 'a', review: 'unreviewed' }, { job_id: 'b', review: 'ok' }]))
      .toEqual({ a: { ok: 1, ng: 1, unreviewed: 1 }, b: { ok: 1, ng: 0, unreviewed: 0 } })
    expect(sumUsedToday([{ item_count: 20, status: 'completed' }, { item_count: 5, status: 'cancelled' }, { item_count: 3, status: 'uploading' }])).toBe(23)
    expect(pageCount(0)).toBe(1); expect(pageCount(20)).toBe(1); expect(pageCount(21)).toBe(2)
  })
})

describe('dates / cost', () => {
  it('jstDayBounds は JST の 1 日を UTC で返す', () => {
    expect(jstDayBounds('2026-09-23')).toEqual({ start: '2026-09-22T15:00:00.000Z', end: '2026-09-23T15:00:00.000Z' })
    expect(jstDayBounds('bad')).toBeNull()
    expect(jstDayRangeUtc(new Date('2026-09-23T15:30:00Z')).day).toBe('2026-09-24')
  })
  it('コストと時間の表示', () => {
    expect(formatCost(0.024)).toBe('$0.024（約 4 円）')
    expect(formatCost(0)).toBe('$0.000（約 0 円）')
    expect(formatDuration(45)).toBe('約 45 秒')
    expect(formatDuration(90)).toBe('約 1 分 30 秒')
    expect(formatDuration(120)).toBe('約 2 分')
  })
})
