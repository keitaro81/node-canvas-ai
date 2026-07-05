import { describe, it, expect } from 'vitest'
import { periodForJst, currentPeriodJst } from './teams'

// クォータの月次キーは JST 基準（UTC+9）。api/fal/proxy.ts / api/team/_teamLogic.ts の currentPeriodJst と
// 一致していなければ「月境界で課金先の月がズレる」。JST オフセット境界を回帰テストで固定する。
describe('periodForJst', () => {
  it('月中央は素直に当月', () => {
    expect(periodForJst(new Date('2026-07-15T03:00:00Z'))).toBe('2026-07')
  })

  it('UTC 6/30 15:00 = JST 7/1 00:00 → 翌月に繰り上がる', () => {
    expect(periodForJst(new Date('2026-06-30T15:00:00Z'))).toBe('2026-07')
  })

  it('UTC 6/30 14:59 = JST 6/30 23:59 → まだ当月', () => {
    expect(periodForJst(new Date('2026-06-30T14:59:59Z'))).toBe('2026-06')
  })

  it('年境界: UTC 12/31 15:00 = JST 翌年 1/1 → 翌年1月', () => {
    expect(periodForJst(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01')
  })

  it('YYYY-MM 形式（7文字）である', () => {
    expect(periodForJst(new Date('2026-01-05T00:00:00Z'))).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('currentPeriodJst', () => {
  it('現在時刻でも YYYY-MM を返す（periodForJst と同一系）', () => {
    expect(currentPeriodJst()).toMatch(/^\d{4}-\d{2}$/)
  })
})
