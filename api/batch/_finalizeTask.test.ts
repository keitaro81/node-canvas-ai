import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeTask, type BatchOpts } from './_batchLogic'

// 切り抜き（dual）の結果保存: マスクは保存できたが透過画像の取得に失敗したとき、完了にせず submitted のまま残す（2026-11-08 メモ 70）
const task = { id: 't1', status: 'submitted', endpoint: 'fal-ai/birefnet/v2', input: { __dual: true, __kind: 'cutout', mask_only: false }, team_id: 'team', job_id: 'job', item_id: 'item', node_id: 'rb', fal_request_id: 'req', attempts: 1 }
const payload = { image: { url: 'https://fal/rgba.png', width: 10, height: 10 }, mask_image: { url: 'https://fal/mask.png', width: 10, height: 10 } }

function fakeAdmin() {
  const calls: { rpc: Array<Record<string, unknown>>; uploads: string[] } = { rpc: [], uploads: [] }
  const chain = (table: string) => {
    const h: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'is', 'neq']) h[m] = () => h
    h.maybeSingle = () => Promise.resolve({ data: table === 'batch_tasks' ? task : null, error: null })
    h.then = (res: (v: unknown) => void) => res({ data: [], error: null })
    return h
  }
  const admin = {
    from: chain,
    storage: { from: () => ({ upload: async (path: string): Promise<{ error: { message: string } | null }> => { calls.uploads.push(path); return { error: null } } }) },
    rpc: async (_name: string, args: Record<string, unknown>) => { calls.rpc.push(args); return { data: true, error: null } },
  }
  return { admin, calls }
}
const opts = { falKey: 'k', appUrl: 'http://localhost' } as unknown as BatchOpts
const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } })

afterEach(() => vi.unstubAllGlobals())

describe('finalizeTask: 切り抜きの透過画像（メモ 70）', () => {
  it('透過画像の取得に失敗したら完了にせず、照合で取り直せるように submitted のまま残す', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('mask.png') ? png() : new Response(null, { status: 502 })))
    const { admin, calls } = fakeAdmin()
    const r = await finalizeTask(admin, opts, 't1', { ok: true, payload, inferenceTime: 1 })
    expect(r).toEqual({ action: 'cutout_fetch_failed', applied: false })
    expect(calls.rpc).toEqual([])   // completed にしていない
    expect(calls.uploads).toEqual(['team/job/item/rb-result.png'])   // マスクは上書き保存（次の照合で再び上書きされる）
  })
  it('透過画像の保存に失敗したときも同じ', async () => {
    vi.stubGlobal('fetch', async () => png())
    const { admin, calls } = fakeAdmin()
    admin.storage = { from: () => ({ upload: async (path: string) => { calls.uploads.push(path); return { error: path.endsWith('-cutout.png') ? { message: 'boom' } : null } } }) }
    const r = await finalizeTask(admin, opts, 't1', { ok: true, payload })
    expect(r).toEqual({ action: 'cutout_store_failed', applied: false })
    expect(calls.rpc).toEqual([])
  })
  it('両方とれたら cutout_path 付きで完了にする', async () => {
    vi.stubGlobal('fetch', async () => png())
    const { admin, calls } = fakeAdmin()
    const r = await finalizeTask(admin, opts, 't1', { ok: true, payload, inferenceTime: 1 })
    expect(r).toEqual({ action: 'completed', applied: true })
    expect(calls.uploads).toEqual(['team/job/item/rb-result.png', 'team/job/item/rb-cutout.png'])
    expect(calls.rpc[0]).toMatchObject({ p_outcome: 'completed', p_result_path: 'team/job/item/rb-result.png', p_result_meta: { cutout_path: 'team/job/item/rb-cutout.png' } })
  })
})
