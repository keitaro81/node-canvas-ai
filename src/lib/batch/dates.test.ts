import { describe, expect, it } from 'vitest'
import { formatRelativeJa } from './dates'

describe('formatRelativeJa', () => {
  const now = Date.parse('2026-10-10T06:00:00.000Z')   // JST 15:00
  const ago = (ms: number) => new Date(now - ms).toISOString()
  it('分・時間・日で丸める', () => {
    expect(formatRelativeJa(ago(20_000), now)).toBe('たった今')
    expect(formatRelativeJa(ago(5 * 60_000), now)).toBe('5分前')
    expect(formatRelativeJa(ago(3 * 3_600_000), now)).toBe('3時間前')
    expect(formatRelativeJa(ago(2 * 86_400_000), now)).toBe('2日前')
  })
  it('30 日以上前は日付、未来や不正は壊れない', () => {
    expect(formatRelativeJa(ago(45 * 86_400_000), now)).toBe('2026-08-26')
    expect(formatRelativeJa(new Date(now + 60_000).toISOString(), now)).toBe('たった今')
    expect(formatRelativeJa('not-a-date', now)).toBe('')
    expect(formatRelativeJa(null, now)).toBe('')
  })
})
