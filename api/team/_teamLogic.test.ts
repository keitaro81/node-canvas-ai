import { describe, it, expect, beforeEach } from 'vitest'
import { teamManage } from './_teamLogic'
import { fakeAdmin, type FakeState } from '../_testAdmin'
import { clearTeamMfaCache, teamRequiresMfa } from '../_auth'

// 2 段階認証のチーム側の操作（2026-11-14）。ここが緩むと「パスワードだけ盗んだオーナーのアカウントから、
// 必須を外す・メンバーの認証アプリを消す」ができてしまうので、認可を回帰テストで固定する。
const OWNER = 'owner-1', MEMBER = 'member-1', OTHER = 'other-1'
const base = (): FakeState => ({
  members: [
    { user_id: OWNER, team_id: 't1', role: 'owner' },
    { user_id: MEMBER, team_id: 't1', role: 'member' },
    { user_id: OTHER, team_id: 't2', role: 'owner' },
  ],
  teams: { t1: { name: 'チーム 1' }, t2: { name: 'チーム 2' } },
  factors: { [OWNER]: ['f-o1'], [MEMBER]: ['f-m1', 'f-m2'] },
})

describe('チームの 2 段階認証: 必須の切り替え（mfa_require）', () => {
  beforeEach(() => clearTeamMfaCache())

  it('オーナーで、本人が 2 段階目を通している（aal2）ときだけ切り替えられる。記録も残る', async () => {
    const admin = fakeAdmin(base())
    const r = await teamManage(admin, OWNER, { action: 'mfa_require', value: true }, { aal: 'aal2' })
    expect(r).toEqual({ status: 200, body: { requireMfa: true } })
    expect(admin.state.teams.t1.require_mfa).toBe(true)
    expect(admin.state.teams.t2.require_mfa).toBeUndefined()   // 他のチームには触らない
    expect(admin.events).toEqual([{ actor_id: OWNER, target_user_id: null, team_id: 't1', action: 'require_on', detail: {} }])
    expect(await teamRequiresMfa(admin, MEMBER)).toBe(true)     // Edge の判定にもすぐ効く（キャッシュを捨てている）
    const off = await teamManage(admin, OWNER, { action: 'mfa_require', value: false }, { aal: 'aal2' })
    expect(off.status).toBe(200)
    expect(admin.state.teams.t1.require_mfa).toBe(false)
    expect(admin.events[1]).toMatchObject({ action: 'require_off' })
  })

  it('メンバーは不可。オーナーでも aal1（パスワードだけ）では不可。保証レベルが渡されない呼び出しも不可', async () => {
    const admin = fakeAdmin(base())
    expect((await teamManage(admin, MEMBER, { action: 'mfa_require', value: true }, { aal: 'aal2' })).status).toBe(403)
    const aal1 = await teamManage(admin, OWNER, { action: 'mfa_require', value: true }, { aal: 'aal1' })
    expect(aal1).toMatchObject({ status: 403, body: { code: 'mfa_aal2_needed' } })
    expect((await teamManage(admin, OWNER, { action: 'mfa_require', value: true })).status).toBe(403)
    expect((await teamManage(admin, OWNER, { action: 'mfa_require' }, { aal: 'aal2' })).status).toBe(400)   // value が無い
    expect(admin.state.teams.t1.require_mfa).toBeUndefined()
    expect(admin.events).toEqual([])
  })

  it('マイグレーション 0023 が未適用なら、保存できないことを伝える（500）', async () => {
    const admin = fakeAdmin({ ...base(), migrated: false })
    const r = await teamManage(admin, OWNER, { action: 'mfa_require', value: true }, { aal: 'aal2' })
    expect(r.status).toBe(500)
    expect(String(r.body.error)).toContain('0023')
  })
})

describe('チームの 2 段階認証: メンバーのリセット（mfa_reset）', () => {
  it('aal2 のオーナーが、同じチームのメンバーの認証アプリをすべて消す。記録も残る', async () => {
    const admin = fakeAdmin(base())
    const r = await teamManage(admin, OWNER, { action: 'mfa_reset', userId: MEMBER }, { aal: 'aal2' })
    expect(r).toEqual({ status: 200, body: { reset: true, removed: 2 } })
    expect(admin.state.factors[MEMBER]).toEqual([])
    expect(admin.state.factors[OWNER]).toEqual(['f-o1'])
    expect(admin.events).toEqual([{ actor_id: OWNER, target_user_id: MEMBER, team_id: 't1', action: 'reset_by_owner', detail: { removed: 2 } }])
  })

  it('自分自身・別のチームの人・aal1 のオーナー・メンバーからの呼び出しは通さない', async () => {
    const admin = fakeAdmin(base())
    expect((await teamManage(admin, OWNER, { action: 'mfa_reset', userId: OWNER }, { aal: 'aal2' })).status).toBe(400)
    expect((await teamManage(admin, OWNER, { action: 'mfa_reset', userId: OTHER }, { aal: 'aal2' })).status).toBe(404)
    expect(await teamManage(admin, OWNER, { action: 'mfa_reset', userId: MEMBER }, { aal: 'aal1' })).toMatchObject({ status: 403, body: { code: 'mfa_aal2_needed' } })
    expect((await teamManage(admin, OWNER, { action: 'mfa_reset', userId: MEMBER })).status).toBe(403)
    expect((await teamManage(admin, MEMBER, { action: 'mfa_reset', userId: OWNER }, { aal: 'aal2' })).status).toBe(403)
    expect((await teamManage(admin, OWNER, { action: 'mfa_reset' }, { aal: 'aal2' })).status).toBe(400)
    expect(admin.state.factors).toEqual({ [OWNER]: ['f-o1'], [MEMBER]: ['f-m1', 'f-m2'] })
    expect(admin.events).toEqual([])
  })
})

describe('チームの一覧（list）に 2 段階認証の状態', () => {
  it('チームの必須フラグと、メンバーごとの登録の有無を返す', async () => {
    const state = base()
    state.teams.t1.require_mfa = true
    state.factors[MEMBER] = []
    const r = await teamManage(fakeAdmin(state), OWNER, { action: 'list' }, { aal: 'aal2' })
    expect(r.status).toBe(200)
    expect(r.body.requireMfa).toBe(true)
    expect((r.body.members as Array<{ userId: string; mfa: boolean | null }>).map((m) => `${m.userId}:${m.mfa}`).sort()).toEqual([`${MEMBER}:false`, `${OWNER}:true`])
  })

  it('マイグレーション 0023 が未適用でも一覧は壊れない（状態は null = 不明・チーム名とクォータはそのまま）', async () => {
    const r = await teamManage(fakeAdmin({ ...base(), migrated: false }), OWNER, { action: 'list' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ teamName: 'チーム 1', requireMfa: null, quota: { image: 100, video: 7 } })
    expect((r.body.members as Array<{ mfa: boolean | null }>).every((m) => m.mfa === null)).toBe(true)
  })
})
