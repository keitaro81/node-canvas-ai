import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

// Supabase / Edge 呼び出しは全部モック。Realtime の購読だけ状態通知を差し替えて、店（store）の見張りの配線を検証する
vi.mock('../lib/api/batchJobs', () => ({
  fetchActiveJobs: vi.fn(async () => []),
  fetchTeamBatchSettings: vi.fn(async () => ({ dailyLimit: 300, showCost: false })),
  fetchTeamBatchLimits: vi.fn(async () => null),
  fetchUsedToday: vi.fn(async () => 0),
  subscribeTeamJobs: vi.fn(() => () => {}),
  disconnectRealtime: vi.fn(),
}))
vi.mock('../lib/api/batch', () => ({
  batchReconcile: vi.fn(async () => ({ checked: 0, completed: 0, failed: 0, resubmitted: 0, pending: 0, skipped: 0 })),
  submitJobFully: vi.fn(async () => ({})),
}))
vi.mock('../lib/api/team', () => ({ getTeamInfo: vi.fn(async () => ({ members: [] })) }))

import { useBatchStore } from './batchStore'
import { disconnectRealtime, fetchActiveJobs, subscribeTeamJobs } from '../lib/api/batchJobs'

type StatusCb = (status: 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR') => void
const subscribeMock = subscribeTeamJobs as unknown as Mock
const disconnectMock = disconnectRealtime as unknown as Mock
const activeJobsMock = fetchActiveJobs as unknown as Mock
const flush = () => new Promise((r) => setTimeout(r, 0))

// 購読は「追いたい画面（watch）がある or 進行中ジョブがある」間だけ。見張りのテストはジョブ管理画面を開いている状態（watch）で行う
describe('batchStore の Realtime 見張り', () => {
  beforeEach(() => { useBatchStore.getState().stop(); subscribeMock.mockReset(); disconnectMock.mockReset(); activeJobsMock.mockReset(); activeJobsMock.mockImplementation(async () => []); vi.spyOn(console, 'warn').mockImplementation(() => {}); useBatchStore.getState().watch('test') })
  afterEach(() => { useBatchStore.getState().unwatch('test'); useBatchStore.getState().stop(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('購読できれば realtimeOk=true', async () => {
    subscribeMock.mockImplementation((_t: string, _c: unknown, onStatus: StatusCb) => { setTimeout(() => onStatus('SUBSCRIBED'), 0); return () => {} })
    await useBatchStore.getState().start('team-1', 'user-1', 'owner')
    await flush()
    expect(useBatchStore.getState().realtimeOk).toBe(true)
    expect(disconnectMock).not.toHaveBeenCalled()
  })

  it('一度も購読できず失敗が 3 回続いたら諦めて disconnect し、realtimeOk=false', async () => {
    subscribeMock.mockImplementation((_t: string, _c: unknown, onStatus: StatusCb) => { setTimeout(() => { onStatus('TIMED_OUT'); onStatus('TIMED_OUT'); onStatus('CHANNEL_ERROR') }, 0); return () => {} })
    await useBatchStore.getState().start('team-2', 'user-1', 'owner')
    await flush()
    expect(useBatchStore.getState().realtimeOk).toBe(false)
    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledTimes(1)   // 諦めた後は購読し直さない
  })

  it('状態通知が無いまま 25 秒たっても諦める（ハンドシェイク失敗で通知が来ない環境）', async () => {
    vi.useFakeTimers()
    subscribeMock.mockImplementation(() => () => {})
    await useBatchStore.getState().start('team-3', 'user-1', 'member')   // 取得はモックの Promise なのでタイマー不要
    expect(useBatchStore.getState().realtimeOk).toBe(null)
    await vi.advanceTimersByTimeAsync(25_500)
    expect(useBatchStore.getState().realtimeOk).toBe(false)
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })

  it('一度つながった後の切断では諦めない（supabase-js の再接続に任せる）', async () => {
    subscribeMock.mockImplementation((_t: string, _c: unknown, onStatus: StatusCb) => { setTimeout(() => { onStatus('SUBSCRIBED'); onStatus('CLOSED'); onStatus('CLOSED'); onStatus('CLOSED'); onStatus('CLOSED') }, 0); return () => {} })
    await useBatchStore.getState().start('team-4', 'user-1', 'owner')
    await flush()
    expect(useBatchStore.getState().realtimeOk).toBe(true)
    expect(disconnectMock).not.toHaveBeenCalled()
  })
})

describe('batchStore の Realtime 購読の要否（Disk IO 対策）', () => {
  beforeEach(() => { useBatchStore.getState().stop(); subscribeMock.mockReset(); disconnectMock.mockReset(); activeJobsMock.mockReset(); activeJobsMock.mockImplementation(async () => []); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { useBatchStore.getState().unwatch('x'); useBatchStore.getState().stop(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('追う画面が無く進行中ジョブも無ければ購読しない', async () => {
    subscribeMock.mockImplementation((_t: string, _c: unknown, onStatus: StatusCb) => { setTimeout(() => onStatus('SUBSCRIBED'), 0); return () => {} })
    await useBatchStore.getState().start('team-5', 'user-1', 'owner')
    await flush()
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(useBatchStore.getState().realtimeOk).toBe(null)
  })

  it('watch で購読を始め、unwatch で切る', async () => {
    const unsub = vi.fn()
    subscribeMock.mockImplementation((_t: string, _c: unknown, onStatus: StatusCb) => { setTimeout(() => onStatus('SUBSCRIBED'), 0); return unsub })
    await useBatchStore.getState().start('team-6', 'user-1', 'owner')
    useBatchStore.getState().watch('x')
    await flush()
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(useBatchStore.getState().realtimeOk).toBe(true)
    useBatchStore.getState().unwatch('x')
    expect(unsub).toHaveBeenCalledTimes(1)
    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(useBatchStore.getState().realtimeOk).toBe(null)
  })

  it('進行中ジョブが見えていれば watch が無くても購読する', async () => {
    activeJobsMock.mockImplementation(async () => [{ id: 'j1', status: 'processing', created_by: 'user-1', updated_at: new Date().toISOString() }])
    subscribeMock.mockImplementation((_t: string, _c: unknown, onStatus: StatusCb) => { setTimeout(() => onStatus('SUBSCRIBED'), 0); return () => {} })
    await useBatchStore.getState().start('team-7', 'user-1', 'owner')
    await flush()
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(useBatchStore.getState().realtimeOk).toBe(true)
  })
})
