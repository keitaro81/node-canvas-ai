import { describe, it, expect } from 'vitest'
import { autoReleaseReason, classifySaveError, editSessionId, lockRequiredFor, lockViewFromAcquire, lockViewOf, LOCK_STALE_MS } from './editLock'

const t0 = Date.parse('2026-10-03T00:00:00Z')
const row = (over: Partial<Parameters<typeof lockViewOf>[0] & object> = {}) => ({
  workflow_id: 'wf', user_id: 'user-a', user_email: 'a@example.com', session_id: 's1',
  acquired_at: new Date(t0).toISOString(), heartbeat_at: new Date(t0).toISOString(), ...over,
})

describe('lockViewOf（編集ロックの表示状態）', () => {
  it('行が無ければ free', () => {
    expect(lockViewOf(null, 'user-a', 's1', t0).state).toBe('free')
  })
  it('自分の同じセッションなら mine、別セッションなら mine-elsewhere', () => {
    expect(lockViewOf(row(), 'user-a', 's1', t0 + 1000).state).toBe('mine')
    expect(lockViewOf(row(), 'user-a', 's2', t0 + 1000).state).toBe('mine-elsewhere')
  })
  it('他の人の有効なロックは held、失効時刻を持つ', () => {
    const v = lockViewOf(row(), 'user-b', 's9', t0 + 1000)
    expect(v.state).toBe('held')
    expect(v.holderEmail).toBe('a@example.com')
    expect(v.staleAt).toBe(t0 + LOCK_STALE_MS)
  })
  it('90 秒更新が無ければ誰のものでも stale（引き継げる）', () => {
    expect(lockViewOf(row(), 'user-b', 's9', t0 + LOCK_STALE_MS).state).toBe('stale')
    expect(lockViewOf(row(), 'user-a', 's1', t0 + LOCK_STALE_MS + 1).state).toBe('stale')
  })
})

describe('lockViewFromAcquire（RPC の結果）', () => {
  it('取得できたら mine', () => {
    expect(lockViewFromAcquire({ ok: true, holder_email: 'a@example.com', stale_at: new Date(t0 + 90_000).toISOString() }, 'user-a', 's1', t0).state).toBe('mine')
  })
  it('他の人が持っていれば held、自分の別タブなら mine-elsewhere', () => {
    const hb = new Date(t0).toISOString()
    expect(lockViewFromAcquire({ ok: false, reason: 'held', holder_user_id: 'user-b', holder_email: 'b@example.com', heartbeat_at: hb }, 'user-a', 's1', t0 + 1000).state).toBe('held')
    expect(lockViewFromAcquire({ ok: false, reason: 'held', holder_user_id: 'user-a', holder_email: 'a@example.com', session_id: 's2', heartbeat_at: hb }, 'user-a', 's1', t0 + 1000).state).toBe('mine-elsewhere')
  })
  it('forbidden / free は free 扱い', () => {
    expect(lockViewFromAcquire({ ok: false, reason: 'forbidden' }, 'user-a', 's1', t0).state).toBe('free')
    expect(lockViewFromAcquire({ ok: false, reason: 'free' }, 'user-a', 's1', t0).state).toBe('free')
  })
})

describe('lockRequiredFor / autoReleaseReason / classifySaveError / editSessionId', () => {
  it('ロックが要るのは許可 ON かつ team/public のときだけ', () => {
    expect(lockRequiredFor({ team_edit: true, visibility: 'team' })).toBe(true)
    expect(lockRequiredFor({ team_edit: true, visibility: 'public' })).toBe(true)
    expect(lockRequiredFor({ team_edit: true, visibility: 'private' })).toBe(false)
    expect(lockRequiredFor({ team_edit: false, visibility: 'team' })).toBe(false)
    expect(lockRequiredFor(null)).toBe(false)
  })
  it('無操作 10 分で idle、タブを隠して 5 分で hidden（hidden を優先）', () => {
    expect(autoReleaseReason(t0 + 9 * 60_000, t0, null)).toBeNull()
    expect(autoReleaseReason(t0 + 10 * 60_000, t0, null)).toBe('idle')
    expect(autoReleaseReason(t0 + 5 * 60_000, t0 + 4 * 60_000, t0)).toBe('hidden')
    expect(autoReleaseReason(t0 + 4 * 60_000, t0, t0 + 60_000)).toBeNull()
  })
  it('保存エラーをロック切れ / 設定変更禁止 / 権限なし / その他に分ける', () => {
    expect(classifySaveError(new Error('workflow_edit_lock_required'))).toBe('lock')
    expect(classifySaveError({ message: 'shared_edit_settings_forbidden' })).toBe('settings')
    expect(classifySaveError(new Error('new row violates row-level security policy for table "workflows"'))).toBe('forbidden')
    expect(classifySaveError(new Error('network'))).toBe('other')
  })
  it('セッション ID は保存されていれば使い回し、無ければ作って保存する', () => {
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    let n = 0
    const rnd = () => `id-${++n}`
    expect(editSessionId(s, rnd)).toBe('id-1')
    expect(editSessionId(s, rnd)).toBe('id-1')
    expect(editSessionId(null, rnd)).toBe('id-2')
  })
})
