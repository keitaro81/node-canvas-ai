export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'
import { withSentry } from '../_sentry'
import { saveImageServer } from './_saveImageLogic'

// fal の一時URLをサーバー側で取得し自前バケットへ保存する Edge エンドポイント。
// ロジックは _saveImageLogic に集約（vite dev /dev-proxy/save-image と共用）。

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

  // JWT 検証（ユーザーのトークンで認証確認）
  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { error: authError } = await userSupabase.auth.getUser(token)
  if (authError) return jsonResponse({ error: 'Forbidden' }, 403)

  let body: { sourceUrl?: string; nodeId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const result = await saveImageServer(admin, body)
  return jsonResponse(result.body, result.status)
}
