import { describe, it, expect } from 'vitest'
import { isOperator } from './_adminLogic'

// 運営 allowlist の判定。ここが緩むと「誰でも運営コンソールを叩ける」ため回帰テストで固定する。
describe('isOperator', () => {
  const A = '11111111-1111-1111-1111-111111111111'
  const B = '22222222-2222-2222-2222-222222222222'

  it('allowlist に含まれる id は true', () => {
    expect(isOperator(A, A)).toBe(true)
    expect(isOperator(B, `${A},${B}`)).toBe(true)
  })

  it('空白や順序に依存せずマッチ', () => {
    expect(isOperator(B, ` ${A} , ${B} `)).toBe(true)
  })

  it('allowlist に無い id は false', () => {
    expect(isOperator('33333333-3333-3333-3333-333333333333', `${A},${B}`)).toBe(false)
  })

  it('部分一致では通さない（完全一致のみ）', () => {
    expect(isOperator(A.slice(0, 20), A)).toBe(false)
    expect(isOperator(A, A.slice(0, 20))).toBe(false)
  })

  it('userId / env が空・未設定なら false（フェイルクローズ）', () => {
    expect(isOperator(null, A)).toBe(false)
    expect(isOperator(undefined, A)).toBe(false)
    expect(isOperator('', A)).toBe(false)
    expect(isOperator(A, undefined)).toBe(false)
    expect(isOperator(A, '')).toBe(false)
    expect(isOperator(A, '   ')).toBe(false)
  })
})
