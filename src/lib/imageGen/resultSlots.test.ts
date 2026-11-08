import { describe, it, expect } from 'vitest'
import { isEmptyResult, planResultSlots } from './resultSlots'

const r = (id: string, y: number, data: Record<string, unknown> = {}) => ({ id, position: { y }, data: { type: 'imageDisplay', label: 'Result', params: {}, ...data } })

describe('Image Generation の Result の割り当て（2026-11-08 メモ 81: 先に置いた空の Result をまず埋める）', () => {
  it('空の Result = status が無いか idle で、結果も requestId も無いもの', () => {
    expect(isEmptyResult({ status: 'idle' })).toBe(true)
    expect(isEmptyResult({})).toBe(true)
    expect(isEmptyResult({ status: 'idle', output: undefined })).toBe(true)
    expect(isEmptyResult({ status: 'done', output: 'https://x/1.png' })).toBe(false)
    expect(isEmptyResult({ status: 'idle', output: 'https://x/1.png' })).toBe(false)   // 結果が入っている
    expect(isEmptyResult({ status: 'generating', requestId: 'req' })).toBe(false)
    expect(isEmptyResult({ status: 'error' })).toBe(false)
    expect(isEmptyResult(null)).toBe(false)
  })
  it('上から順に空の Result を使い、足りない分だけ新しく作る', () => {
    const existing = [r('done', 0, { status: 'done', output: 'https://x/a.png' }), r('e2', 800, { status: 'idle' }), r('e1', 400, {})]
    expect(planResultSlots(existing, 1)).toEqual({ reuseIds: ['e1'], createCount: 0 })
    expect(planResultSlots(existing, 2)).toEqual({ reuseIds: ['e1', 'e2'], createCount: 0 })
    expect(planResultSlots(existing, 4)).toEqual({ reuseIds: ['e1', 'e2'], createCount: 2 })
    expect(planResultSlots([], 3)).toEqual({ reuseIds: [], createCount: 3 })
    expect(planResultSlots(existing, 0)).toEqual({ reuseIds: [], createCount: 0 })
  })
})
