import { describe, it, expect } from 'vitest'
import { aalOfJwt, hasVerifiedFactor, isMfaRequiredResponse, mfaGateOf, mfaRequiredBody } from './mfaGate'

// ブラウザ向けの型設定で通るように Buffer は使わない（UTF-8 のバイト列 → base64url）
const b64url = (o: unknown) => {
  let bin = ''
  for (const b of new TextEncoder().encode(JSON.stringify(o))) bin += String.fromCharCode(b)
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
const jwt = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`

describe('2 段階認証の判定（2026-11-14・規則は 1 つ）', () => {
  it('aal2 なら常に通す。aal1 は「要素あり → コード入力」「チーム必須で要素なし → 登録」「どちらでもない → 通す」', () => {
    expect(mfaGateOf({ aal: 'aal2', hasVerifiedFactor: true, requiredByTeam: true })).toBe('ok')
    expect(mfaGateOf({ aal: 'aal2', hasVerifiedFactor: false, requiredByTeam: true })).toBe('ok')   // リセット直後の既存セッションなど
    expect(mfaGateOf({ aal: 'aal1', hasVerifiedFactor: true, requiredByTeam: false })).toBe('challenge')
    expect(mfaGateOf({ aal: 'aal1', hasVerifiedFactor: true, requiredByTeam: true })).toBe('challenge')
    expect(mfaGateOf({ aal: 'aal1', hasVerifiedFactor: false, requiredByTeam: true })).toBe('enroll')
    expect(mfaGateOf({ aal: 'aal1', hasVerifiedFactor: false, requiredByTeam: false })).toBe('ok')   // 今の利用者は何も変わらない
  })
  it('JWT の aal を読む。無い・壊れている・空は aal1', () => {
    expect(aalOfJwt(jwt({ sub: 'u', aal: 'aal2', email: 'テスト@example.com' }))).toBe('aal2')
    expect(aalOfJwt(jwt({ sub: 'u', aal: 'aal1' }))).toBe('aal1')
    expect(aalOfJwt(jwt({ sub: 'u' }))).toBe('aal1')
    expect(aalOfJwt(jwt({ sub: 'u', aal: 'aal3' }))).toBe('aal1')   // 知らない値は上げない
    expect(aalOfJwt('not-a-jwt')).toBe('aal1')
    expect(aalOfJwt('a.%%%.c')).toBe('aal1')
    expect(aalOfJwt('')).toBe('aal1')
    expect(aalOfJwt(null)).toBe('aal1')
  })
  it('検証済みの要素だけを数える（登録途中の unverified は数えない）', () => {
    expect(hasVerifiedFactor([{ status: 'unverified' }, { status: 'verified' }])).toBe(true)
    expect(hasVerifiedFactor([{ status: 'unverified' }])).toBe(false)
    expect(hasVerifiedFactor([])).toBe(false)
    expect(hasVerifiedFactor(null)).toBe(false)
    expect(hasVerifiedFactor(undefined)).toBe(false)
  })
  it('403 の本文: error は画面に出せる文、code で機械的に判定できる', () => {
    const body = mfaRequiredBody('challenge')
    expect(body).toMatchObject({ code: 'mfa_required', gate: 'challenge' })
    expect(body.error).toContain('認証アプリのコード')
    expect(mfaRequiredBody('enroll').error).toContain('必須')
    expect(isMfaRequiredResponse(403, body)).toBe(true)
    expect(isMfaRequiredResponse(403, { error: 'Forbidden' })).toBe(false)
    expect(isMfaRequiredResponse(200, body)).toBe(false)
    expect(isMfaRequiredResponse(403, null)).toBe(false)
  })
})
