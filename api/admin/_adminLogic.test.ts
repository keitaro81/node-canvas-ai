import { describe, it, expect } from 'vitest'
import { adminManage, isOperator } from './_adminLogic'
import { fakeAdmin, type FakeState } from '../_testAdmin'

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

// 運営コンソールは 2 段階認証を済ませた運営だけ（2026-11-14）。他人のアカウントを作り、認証アプリの登録を消せる面なので固定する
describe('adminManage: 運営コンソールは aal2 が必須・2 段階認証のリセット', () => {
  const OP = '11111111-1111-1111-1111-111111111111'
  const base = (): FakeState => ({
    members: [{ user_id: 'u-owner', team_id: 't1', role: 'owner' }],
    teams: { t1: { name: '支店 1' } },
    factors: { 'u-owner': ['f1', 'f2'] },
    users: [{ id: 'u-owner', email: 'Owner@Example.com' }, { id: OP, email: 'op@example.com' }],
  })

  it('運営でなければ 403（理由は出さない）。運営でも aal1 なら 403 + code mfa_required', async () => {
    const admin = fakeAdmin(base())
    expect(await adminManage(admin, 'someone-else', OP, { action: 'list' }, { aal: 'aal2' })).toEqual({ status: 403, body: { error: 'Forbidden' } })
    const aal1 = await adminManage(admin, OP, OP, { action: 'list' }, { aal: 'aal1' })
    expect(aal1).toMatchObject({ status: 403, body: { code: 'mfa_required' } })
    expect(String(aal1.body.error)).toContain('2 段階認証')
    expect((await adminManage(admin, OP, OP, { action: 'list' }, { aal: 'aal2' })).status).toBe(200)
  })

  it('mfa_reset: メールアドレス（大文字小文字は区別しない）で探して、認証アプリの登録をすべて消す。記録も残る', async () => {
    const admin = fakeAdmin(base())
    const r = await adminManage(admin, OP, OP, { action: 'mfa_reset', email: ' owner@example.com ' }, { aal: 'aal2' })
    expect(r).toEqual({ status: 200, body: { reset: true, removed: 2, email: 'owner@example.com' } })
    expect(admin.state.factors['u-owner']).toEqual([])
    expect(admin.events).toEqual([{ actor_id: OP, target_user_id: 'u-owner', team_id: 't1', action: 'reset_by_operator', detail: { removed: 2 } }])
  })

  it('mfa_reset: 形式が違うメール → 400・いない人 → 404・aal1 の運営 → 403（何も消さない）', async () => {
    const admin = fakeAdmin(base())
    expect((await adminManage(admin, OP, OP, { action: 'mfa_reset', email: 'not-an-email' }, { aal: 'aal2' })).status).toBe(400)
    expect((await adminManage(admin, OP, OP, { action: 'mfa_reset', email: 'nobody@example.com' }, { aal: 'aal2' })).status).toBe(404)
    expect((await adminManage(admin, OP, OP, { action: 'mfa_reset', email: 'owner@example.com' }, { aal: 'aal1' })).status).toBe(403)
    expect(admin.state.factors['u-owner']).toEqual(['f1', 'f2'])
    expect(admin.events).toEqual([])
  })
})
