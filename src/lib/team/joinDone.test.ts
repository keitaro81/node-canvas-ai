import { describe, it, expect } from 'vitest'
import { JOIN_DONE_TTL_MS, clearJoinDone, markJoinDone, readJoinDone } from './joinDone'

/** sessionStorage の代わり */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    raw: m,
  }
}

describe('招待リンクの「参加が済んだ」印', () => {
  it('付けた印は、同じ招待リンクでだけ読める（チーム名つき）', () => {
    const st = fakeStorage()
    markJoinDone('tok-a', 'チーム A', 1_000, st)
    expect(readJoinDone('tok-a', 2_000, st)).toEqual({ teamName: 'チーム A' })
    expect(readJoinDone('tok-b', 2_000, st)).toBeNull()
    expect(readJoinDone(undefined, 2_000, st)).toBeNull()
  })

  it('チーム名が無くても印は有効（名前は null）', () => {
    const st = fakeStorage()
    markJoinDone('tok-a', null, 1_000, st)
    expect(readJoinDone('tok-a', 2_000, st)).toEqual({ teamName: null })
  })

  it('10 分を過ぎた印は読まない（古い印で「参加しました」と出し続けない）', () => {
    const st = fakeStorage()
    markJoinDone('tok-a', 'チーム A', 1_000, st)
    expect(readJoinDone('tok-a', 1_000 + JOIN_DONE_TTL_MS, st)).not.toBeNull()
    expect(readJoinDone('tok-a', 1_000 + JOIN_DONE_TTL_MS + 1, st)).toBeNull()
  })

  it('チームを離れたら印を全部捨てる。ほかの値には触らない', () => {
    const st = fakeStorage()
    markJoinDone('tok-a', 'チーム A', 1_000, st)
    markJoinDone('tok-b', 'チーム B', 1_000, st)
    st.setItem('other', 'keep')
    clearJoinDone(st)
    expect(readJoinDone('tok-a', 2_000, st)).toBeNull()
    expect(readJoinDone('tok-b', 2_000, st)).toBeNull()
    expect(st.getItem('other')).toBe('keep')
  })

  it('壊れた値・保存できない環境でも落ちない', () => {
    const st = fakeStorage()
    st.setItem('join:done:tok-a', 'not json')
    expect(readJoinDone('tok-a', 2_000, st)).toBeNull()
    st.setItem('join:done:tok-b', JSON.stringify({ teamName: 'x' }))   // 時刻が無い
    expect(readJoinDone('tok-b', 2_000, st)).toBeNull()
    expect(readJoinDone('tok-a', 2_000, null)).toBeNull()
    expect(() => markJoinDone('tok-a', 'x', 1_000, null)).not.toThrow()
    expect(() => clearJoinDone(null)).not.toThrow()
  })
})
