// テスト用: service role の Supabase クライアント（admin）の代役（2026-11-14・2 段階認証のサーバー処理のテストで使う）。
// `_` 始まりなので Vercel のルーティング対象外。入口からは import しない（テストだけ）。
// 必要な範囲だけを真似る: team_members / teams / usage_counters / team_invites / mfa_events の select・update・insert、
// rpc('team_mfa_overview' / 'team_requires_mfa')、auth.admin の getUserById / listUsers / mfa.listFactors / mfa.deleteFactor。
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FakeState {
  members: Array<{ user_id: string; team_id: string; role: 'owner' | 'member'; created_at?: string }>
  teams: Record<string, { name: string; quota_image_monthly?: number; quota_video_monthly?: number; require_mfa?: boolean; created_at?: string }>
  /** user_id → 検証済みの要素の id */
  factors: Record<string, string[]>
  users?: Array<{ id: string; email: string }>
  /** false = マイグレーション 0023 が未適用（teams.require_mfa と RPC が無い） */
  migrated?: boolean
}

export function fakeAdmin(state: FakeState) {
  const migrated = state.migrated !== false
  const events: Array<Record<string, unknown>> = []
  const users = state.users ?? []

  function run(q: { table: string; op: string; payload: any; filters: Record<string, unknown>; cols: string }, single: boolean): { data: any; error: any } {
    const match = (row: Record<string, unknown>) => Object.entries(q.filters).every(([k, v]) => row[k] === v)
    if (q.table === 'team_members') {
      const rows = state.members.filter((m) => match(m as unknown as Record<string, unknown>))
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    if (q.table === 'teams') {
      if (q.op === 'update') {
        if ('require_mfa' in (q.payload ?? {}) && !migrated) return { data: null, error: { code: '42703', message: 'column "require_mfa" of relation "teams" does not exist' } }
        const id = q.filters.id as string
        if (state.teams[id]) Object.assign(state.teams[id], q.payload)
        return { data: null, error: null }
      }
      if (q.cols.includes('require_mfa') && !migrated) return { data: null, error: { code: '42703', message: 'column teams.require_mfa does not exist' } }
      const rows = Object.entries(state.teams).map(([id, t]) => ({ id, quota_image_monthly: 100, quota_video_monthly: 7, created_at: '2026-01-01T00:00:00Z', require_mfa: false, ...t })).filter((t) => match(t))
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    if (q.table === 'mfa_events') {
      if (!migrated) return { data: null, error: { code: '42P01', message: 'relation "public.mfa_events" does not exist' } }
      if (q.op === 'insert') events.push(q.payload)
      return { data: null, error: null }
    }
    return { data: single ? null : [], error: null }   // usage_counters / team_invites など
  }

  const from = (table: string) => {
    const q = { table, op: 'select', payload: null as any, filters: {} as Record<string, unknown>, cols: '' }
    const b: any = {
      select: (cols = '') => { if (q.op === 'select') q.cols = cols; return b },
      update: (payload: any) => { q.op = 'update'; q.payload = payload; return b },
      insert: (payload: any) => { q.op = 'insert'; q.payload = payload; return b },
      eq: (k: string, v: unknown) => { q.filters[k] = v; return b },
      maybeSingle: async () => run(q, true),
      single: async () => run(q, true),
      then: (resolve: (v: { data: any; error: any }) => unknown) => resolve(run(q, false)),
    }
    for (const passthrough of ['order', 'limit', 'is', 'gt', 'in']) b[passthrough] = () => b
    return b
  }

  const rpc = async (fn: string, args: any) => {
    if (!migrated) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } }
    if (fn === 'team_mfa_overview') {
      return { data: state.members.filter((m) => m.team_id === args.p_team_id).map((m) => ({ user_id: m.user_id, has_factor: (state.factors[m.user_id] ?? []).length > 0 })), error: null }
    }
    if (fn === 'team_requires_mfa') {
      const m = state.members.find((x) => x.user_id === args.p_user_id)
      return { data: !!m && state.teams[m.team_id]?.require_mfa === true, error: null }
    }
    return { data: null, error: { code: 'PGRST202', message: `unknown function ${fn}` } }
  }

  const auth = {
    admin: {
      getUserById: async (id: string) => ({ data: { user: users.find((u) => u.id === id) ?? { id, email: `${id}@example.com` } }, error: null }),
      listUsers: async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number }) => ({ data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }),
      mfa: {
        listFactors: async ({ userId }: { userId: string }) => ({ data: { factors: (state.factors[userId] ?? []).map((id) => ({ id })) }, error: null }),
        deleteFactor: async ({ id, userId }: { id: string; userId: string }) => {
          state.factors[userId] = (state.factors[userId] ?? []).filter((f) => f !== id)
          return { data: { id }, error: null }
        },
      },
    },
  }

  return { from, rpc, auth, events, state }
}
