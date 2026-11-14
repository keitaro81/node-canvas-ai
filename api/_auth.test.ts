import { describe, it, expect, beforeEach } from 'vitest'
import { callerOf, clearTeamMfaCache, mfaBlock, mfaGateFor, teamRequiresMfa } from './_auth'

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const jwt = (aal?: string) => `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'u1', ...(aal ? { aal } : {}) })}.sig`

/** team_requires_mfa の応答を決められる admin の代役（呼ばれた回数も数える） */
function fakeAdmin(reply: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const calls: Array<{ fn: string; args: unknown }> = []
  return { calls, rpc: async (fn: string, args: unknown) => { calls.push({ fn, args }); return { data: reply.data ?? null, error: reply.error ?? null } } }
}

describe('Edge の 2 段階認証の確認（api/_auth.ts）', () => {
  beforeEach(() => clearTeamMfaCache())

  it('呼び出し者: トークンの aal と、user.factors の検証済みの有無', () => {
    expect(callerOf({ id: 'u1', factors: [{ status: 'verified' }] }, jwt('aal1'))).toEqual({ userId: 'u1', aal: 'aal1', hasVerifiedFactor: true })
    expect(callerOf({ id: 'u1' }, jwt('aal2'))).toEqual({ userId: 'u1', aal: 'aal2', hasVerifiedFactor: false })
    expect(callerOf({ id: 'u1', factors: [{ status: 'unverified' }] }, jwt())).toEqual({ userId: 'u1', aal: 'aal1', hasVerifiedFactor: false })
  })

  it('aal2 と「要素あり」は DB を引かずに決まる', async () => {
    const admin = fakeAdmin({ data: true })
    expect(await mfaGateFor(admin, { userId: 'u1', aal: 'aal2', hasVerifiedFactor: true })).toBe('ok')
    expect(await mfaGateFor(admin, { userId: 'u1', aal: 'aal1', hasVerifiedFactor: true })).toBe('challenge')
    expect(admin.calls).toEqual([])
  })

  it('要素なしの aal1 はチームの必須フラグで決まる（必須 → 登録が要る・それ以外 → 通す）', async () => {
    const required = fakeAdmin({ data: true })
    expect(await mfaGateFor(required, { userId: 'u1', aal: 'aal1', hasVerifiedFactor: false })).toBe('enroll')
    expect(required.calls).toEqual([{ fn: 'team_requires_mfa', args: { p_user_id: 'u1' } }])
    clearTeamMfaCache()
    expect(await mfaGateFor(fakeAdmin({ data: false }), { userId: 'u1', aal: 'aal1', hasVerifiedFactor: false })).toBe('ok')
  })

  it('必須フラグは 30 秒キャッシュする。切り替え後は捨てれば引き直す', async () => {
    const admin = fakeAdmin({ data: false })
    expect(await teamRequiresMfa(admin, 'u1', 1_000)).toBe(false)
    expect(await teamRequiresMfa(admin, 'u1', 20_000)).toBe(false)
    expect(admin.calls.length).toBe(1)
    expect(await teamRequiresMfa(admin, 'u1', 40_000)).toBe(false)   // 30 秒を過ぎたら引き直す
    expect(admin.calls.length).toBe(2)
    clearTeamMfaCache('u1')
    await teamRequiresMfa(admin, 'u1', 41_000)
    expect(admin.calls.length).toBe(3)
  })

  it('マイグレーション 0023 が未適用（関数が無い）なら必須ではない扱い。それ以外の失敗は投げる（黙って通さない）', async () => {
    expect(await teamRequiresMfa(fakeAdmin({ error: { code: 'PGRST202', message: 'Could not find the function public.team_requires_mfa(p_user_id) in the schema cache' } }), 'u1')).toBe(false)
    clearTeamMfaCache()
    await expect(teamRequiresMfa(fakeAdmin({ error: { code: '57014', message: 'canceling statement due to statement timeout' } }), 'u1')).rejects.toThrow('team_requires_mfa failed')
  })

  it('入口用: 通してよければ null、だめなら 403 と code = mfa_required', async () => {
    const admin = fakeAdmin({ data: true })
    expect(await mfaBlock(admin, { userId: 'u1', aal: 'aal2', hasVerifiedFactor: true })).toBeNull()
    const challenge = await mfaBlock(admin, { userId: 'u1', aal: 'aal1', hasVerifiedFactor: true })
    expect(challenge).toMatchObject({ status: 403, body: { code: 'mfa_required', gate: 'challenge' } })
    const enroll = await mfaBlock(admin, { userId: 'u2', aal: 'aal1', hasVerifiedFactor: false })
    expect(enroll).toMatchObject({ status: 403, body: { code: 'mfa_required', gate: 'enroll' } })
  })
})
