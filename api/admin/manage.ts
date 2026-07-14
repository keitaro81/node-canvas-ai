export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'
import { withSentry } from '../_sentry'
import { adminManage, type AdminManageBody } from './_adminLogic'

// 運営専用の管理エンドポイント。JWT を検証 → 運営 allowlist(ADMIN_USER_IDS) をゲート → 共有コアへ。
// ロジックは _adminLogic に集約（vite dev /dev-proxy/admin-manage と共用）。

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export default withSentry(handler)

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return jsonResponse({ error: 'Forbidden' }, 403)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // JWT 検証 → userId（運営判定は共有コア内で ADMIN_USER_IDS と照合）
  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authError } = await userSupabase.auth.getUser(token)
  if (authError || !user) return jsonResponse({ error: 'Forbidden' }, 403)

  let body: AdminManageBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const result = await adminManage(admin, user.id, process.env.ADMIN_USER_IDS, body)
  return jsonResponse(result.body, result.status)
}
