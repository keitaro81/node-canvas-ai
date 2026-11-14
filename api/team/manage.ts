export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'
import { withSentry } from '../_sentry'
import { teamManage, actionNeedsAuth, type TeamManageBody } from './_teamLogic'
import { callerOf, mfaBlock, type Caller } from '../_auth'

// チーム管理エンドポイント。JWT を検証→service role で teamManage を実行。
// action: invite / join / leave / remove / role / list（認可は各 action 内）。
// 設計: docs/specs/team-management-mvp.md §6

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export default withSentry(handler)

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  let body: TeamManageBody
  try {
    body = await req.json() as typeof body
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  // preview / signup（invite-gated signup）は未認証で可。それ以外は JWT 検証 → userId
  let caller: Caller | null = null
  if (actionNeedsAuth(body?.action)) {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return jsonResponse({ error: 'Forbidden' }, 403)
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user }, error: authError } = await userSupabase.auth.getUser(token)
    if (authError || !user) return jsonResponse({ error: 'Forbidden' }, 403)
    caller = callerOf(user, token)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  if (caller) {
    // 2 段階認証が必要なのに済んでいないセッションは通さない（2026-11-14・規則は src/lib/auth/mfaGate.ts）
    const blocked = await mfaBlock(admin, caller)
    if (blocked) return jsonResponse(blocked.body, blocked.status)
  }
  const result = await teamManage(admin, caller?.userId ?? null, body, caller ? { aal: caller.aal } : undefined)
  return jsonResponse(result.body, result.status)
}
