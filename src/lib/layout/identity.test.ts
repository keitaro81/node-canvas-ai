import { describe, it, expect } from 'vitest'
import { layoutHash, layoutIdentityString } from './identity'
import { DEFAULT_LAYOUT_PARAMS } from './computeLayout'

const base = { params: DEFAULT_LAYOUT_PARAMS, sourceRef: 'https://x/o.jpg', maskPath: 't/interactive/n/1-mask.png', alphaThreshold: 8, featherPx: 0 }

describe('layoutHash（レイアウトの識別値）', () => {
  it('同じ入力なら同じ値、パラメータのキー順にも依存しない', async () => {
    const a = await layoutHash(base)
    const b = await layoutHash({ ...base, params: { ...DEFAULT_LAYOUT_PARAMS, width: 1200 } })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  it('パラメータ・マスク・元画像・しきい値のどれかが違えば値が変わる', async () => {
    const a = await layoutHash(base)
    expect(await layoutHash({ ...base, params: { ...DEFAULT_LAYOUT_PARAMS, marginTop: 9 } })).not.toBe(a)
    expect(await layoutHash({ ...base, maskPath: 'other' })).not.toBe(a)
    expect(await layoutHash({ ...base, sourceRef: 'other' })).not.toBe(a)
    expect(await layoutHash({ ...base, alphaThreshold: 9 })).not.toBe(a)
    expect(await layoutHash({ ...base, backgroundRef: 'bg' })).not.toBe(a)
  })
  it('識別文字列は正規化済みパラメータを含む（不正値は既定値に）', () => {
    const s = layoutIdentityString({ ...base, params: { ...DEFAULT_LAYOUT_PARAMS, backgroundColor: 'oops' as never } })
    expect(s).toContain('"backgroundColor":"#FFFFFF"')
  })
})
