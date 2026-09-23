import { describe, it, expect, vi } from 'vitest'

// Supabase クライアントをモックし、自分の行だけを引いていること（user_id で絞る）と役割の解決を固定する
const calls: Array<[string, unknown[]]> = []
const rows: Record<string, unknown[]> = {
  team_members: [
    { team_id: 't1', role: 'owner', user_id: 'owner-1' },   // 同じチームの他人の行（RLS で読める）
    { team_id: 't1', role: 'member', user_id: 'me' },
  ],
  teams: [{ id: 't1', quota_image_monthly: 100, quota_video_monthly: 7 }],
  usage_counters: [],
}
function builder(table: string) {
  let data = rows[table] ?? []
  const b: Record<string, unknown> = {}
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push([`${table}.${name}`, args])
    if (name === 'eq') data = data.filter((r) => (r as Record<string, unknown>)[args[0] as string] === args[1])
    return b
  }
  for (const n of ['select', 'eq', 'limit', 'order']) b[n] = chain(n)
  b.maybeSingle = async () => ({ data: data[0] ?? null })
  b.then = (res: (v: { data: unknown[] }) => void) => res({ data })
  return b
}
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
    from: (table: string) => builder(table),
  },
}))

import { getMyTeamContext } from './teams'

describe('getMyTeamContext', () => {
  it('自分の行だけを user_id で引き、役割は自分のもの（他人の owner 行を拾わない）', async () => {
    const ctx = await getMyTeamContext()
    expect(ctx?.teamId).toBe('t1')
    expect(ctx?.role).toBe('member')
    expect(calls.some(([n, a]) => n === 'team_members.eq' && a[0] === 'user_id' && a[1] === 'me')).toBe(true)
  })
})
