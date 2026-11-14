import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 2 段階認証の判定ストア（画面側の関門）。ここが狂うと「読み込み中のまま止まる」「コード入力が出ない」になるので、
// 決め方を回帰テストで固定する（強制そのものはサーバー側。ここは画面を出す／出さないだけ）。

/** JWT の形だけ作る（署名は見ない） */
function jwt(aal: 'aal1' | 'aal2'): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', aal })}.sig`
}

type FakeSession = { access_token: string; user: { id: string; factors?: Array<{ status: string }> } }
const h = vi.hoisted(() => ({
  session: null as FakeSession | null,
  listVerifiedFactors: vi.fn(),
  fetchRequiredByTeam: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: h.session } }) } } }))
vi.mock('../lib/api/mfa', () => ({ listVerifiedFactors: h.listVerifiedFactors, fetchRequiredByTeam: h.fetchRequiredByTeam }))

import { useMfaStore } from './mfaStore'
import { noteMfaResponse } from '../lib/auth/mfaSignal'
import { mfaRequiredBody } from '../lib/auth/mfaGate'

const FACTOR = { id: 'f1', name: '認証アプリ', createdAt: '2026-11-14T00:00:00Z' }
const store = new Map<string, string>()
const login = (aal: 'aal1' | 'aal2', factors: Array<{ status: string }> = []) => { h.session = { access_token: jwt(aal), user: { id: 'u1', factors } } }
const state = () => useMfaStore.getState()
/** 解決を外から操れる Promise */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  })
  h.session = null
  h.listVerifiedFactors.mockReset().mockResolvedValue([])
  h.fetchRequiredByTeam.mockReset().mockResolvedValue(false)
  state().reset()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('mfaStore.refresh: 判定', () => {
  it('未ログインなら「まだ判定していない」に戻す（サーバーへは聞かない）', async () => {
    await state().refresh()
    expect(state().status).toBe('unknown')
    expect(h.fetchRequiredByTeam).not.toHaveBeenCalled()
  })

  it('2 段階目を通したセッション（aal2）は通す。登録済みの認証アプリの一覧も持つ', async () => {
    login('aal2', [{ status: 'verified' }])
    h.listVerifiedFactors.mockResolvedValue([FACTOR])
    h.fetchRequiredByTeam.mockResolvedValue(true)
    await state().refresh()
    expect(state()).toMatchObject({ status: 'ok', aal: 'aal2', factors: [FACTOR], requiredByTeam: true })
  })

  it('aal1 で認証アプリを登録済みなら、サーバーの答えを待たずにコード入力を出す', async () => {
    login('aal1', [{ status: 'verified' }])
    const d = deferred<boolean | null>()
    h.listVerifiedFactors.mockResolvedValue([FACTOR])
    h.fetchRequiredByTeam.mockReturnValue(d.promise)
    const p = state().refresh()
    await flush()
    expect(state().status).toBe('challenge')   // まだサーバーは答えていない
    d.resolve(false)
    await p
    expect(state()).toMatchObject({ status: 'challenge', factors: [FACTOR] })
  })

  it('この端末で初めての人（覚えが無い）は、サーバーの答えを待つ。必須のチームなら登録の画面', async () => {
    login('aal1')
    const d = deferred<boolean | null>()
    h.fetchRequiredByTeam.mockReturnValue(d.promise)
    const p = state().refresh()
    await flush()
    expect(state().status).toBe('unknown')
    d.resolve(true)
    await p
    expect(state()).toMatchObject({ status: 'enroll', requiredByTeam: true })
    expect(store.get('mfa:required:u1')).toBe('1')   // 次に開いたときのために覚える
  })

  it('前回は必須でなかった人は、すぐ通す。その後サーバーが「必須になった」と答えたら登録の画面へ切り替える', async () => {
    login('aal1')
    store.set('mfa:required:u1', '0')
    const d = deferred<boolean | null>()
    h.fetchRequiredByTeam.mockReturnValue(d.promise)
    const p = state().refresh()
    await flush()
    expect(state().status).toBe('ok')
    d.resolve(true)
    await p
    expect(state().status).toBe('enroll')
  })

  it('要素も必須も無い人（今の利用者の大半）は通す', async () => {
    login('aal1')
    await state().refresh()
    expect(state()).toMatchObject({ status: 'ok', aal: 'aal1', factors: [], requiredByTeam: false })
    expect(store.get('mfa:required:u1')).toBe('0')
  })

  it('他の端末で登録した直後（手元のセッションには要素が無い）でも、サーバーの一覧に従ってコード入力を出す', async () => {
    login('aal1')
    store.set('mfa:required:u1', '0')
    h.listVerifiedFactors.mockResolvedValue([FACTOR])
    await state().refresh()
    expect(state().status).toBe('challenge')
  })
})

describe('mfaStore.refresh: サーバーに聞けないとき（止めずに手元の値で決める）', () => {
  it('通信の失敗: 前回が必須なら登録の画面、覚えが無ければ通す（強制はサーバー側にある）', async () => {
    login('aal1')
    h.listVerifiedFactors.mockRejectedValue(new Error('network'))
    h.fetchRequiredByTeam.mockResolvedValue(null)
    store.set('mfa:required:u1', '1')
    await state().refresh()
    expect(state().status).toBe('enroll')

    state().reset()
    store.clear()
    await state().refresh()
    expect(state().status).toBe('ok')
  })

  it('答えが返ってこないとき: 8 秒で打ち切って手元の値で決める（読み込み中のまま止めない）', async () => {
    vi.useFakeTimers()
    login('aal1')
    h.listVerifiedFactors.mockReturnValue(new Promise(() => {}))
    h.fetchRequiredByTeam.mockReturnValue(new Promise(() => {}))
    const p = state().refresh()
    await vi.advanceTimersByTimeAsync(7_900)
    expect(state().status).toBe('unknown')
    await vi.advanceTimersByTimeAsync(200)
    await p
    expect(state().status).toBe('ok')
  })
})

describe('mfaStore.refresh: 問い合わせの回数', () => {
  it('同時に何度呼ばれても 1 回にまとめる。途中で「必ず問い合わせる」が来たら、終わった後にもう 1 回だけ', async () => {
    login('aal1')
    const d = deferred<boolean | null>()
    h.fetchRequiredByTeam.mockReturnValueOnce(d.promise)
    const p1 = state().refresh()
    const p2 = state().refresh()
    void state().refresh(true)
    await flush()
    expect(h.fetchRequiredByTeam).toHaveBeenCalledTimes(1)
    d.resolve(false)
    await Promise.all([p1, p2])
    await flush()
    await vi.waitFor(() => expect(h.fetchRequiredByTeam).toHaveBeenCalledTimes(2))
  })

  it('取り直した直後（30 秒以内）は問い合わせ直さない。「必ず」のときと、保証レベルが変わったときは問い合わせる', async () => {
    login('aal1', [{ status: 'verified' }])
    h.listVerifiedFactors.mockResolvedValue([FACTOR])
    await state().refresh()
    await state().refresh()
    expect(h.fetchRequiredByTeam).toHaveBeenCalledTimes(1)
    await state().refresh(true)
    expect(h.fetchRequiredByTeam).toHaveBeenCalledTimes(2)
    login('aal2', [{ status: 'verified' }])   // コード入力を通した
    await state().refresh()
    expect(h.fetchRequiredByTeam).toHaveBeenCalledTimes(3)
    expect(state().status).toBe('ok')
  })

  it('サーバーが 403 ＋ code mfa_required で断ったら、判定を取り直す', async () => {
    login('aal1')
    await state().refresh()
    expect(state().status).toBe('ok')
    h.fetchRequiredByTeam.mockResolvedValue(true)   // その間にオーナーが必須にした
    noteMfaResponse(403, mfaRequiredBody('enroll'))
    await vi.waitFor(() => expect(state().status).toBe('enroll'))
  })
})
