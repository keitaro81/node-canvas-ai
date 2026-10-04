import { describe, expect, it } from 'vitest'
import { isAutoJobName, jobLabel } from './jobLabel'

describe('jobLabel', () => {
  it('自動命名（日時 + 枚数）を見分ける', () => {
    expect(isAutoJobName('2026-10-04 19:27 2枚')).toBe(true)
    expect(isAutoJobName('2026-10-04 19:27 12 枚')).toBe(true)
    expect(isAutoJobName('')).toBe(true)
    expect(isAutoJobName(null)).toBe(true)
    expect(isAutoJobName('秋物 第 1 便')).toBe(false)
    expect(isAutoJobName('2026-10-04 19:27 2枚 やり直し')).toBe(false)
  })
  it('履歴の 1 行は 日時・枚数・状態。自動命名なら名前を重ねず、任意の名前は後ろに添える', () => {
    const base = { created_at: '2026-10-04T10:27:00.000Z', item_count: 2, status: 'completed' as const }
    expect(jobLabel({ ...base, name: '2026-10-04 19:27 2枚' })).toBe('2026-10-04 19:27・2 枚・完了')
    expect(jobLabel({ ...base, name: ' 秋物 第 1 便 ' })).toBe('2026-10-04 19:27・2 枚・完了・秋物 第 1 便')
    expect(jobLabel({ ...base, name: 'x', status: 'uploading' })).toBe('2026-10-04 19:27・2 枚・送信中・x')
    expect(jobLabel({ ...base, name: '2026-10-04 19:27 2枚' }, '田中')).toBe('2026-10-04 19:27・2 枚・完了・田中')
    expect(jobLabel({ ...base, name: '2026-10-04 19:27 2枚' }, null)).toBe('2026-10-04 19:27・2 枚・完了')
  })
})
