export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'
import { withSentry } from '../_sentry'
import { falProxyCore, jsonResponse, FAL_TARGET_URL_HEADER } from './_proxyLogic'

// fal.ai プロキシ（Edge）。JWT を検証し、allowlist・クォータ・転送は _proxyLogic（vite dev /dev-proxy/fal と共用）。
// フロントは fal 鍵を一切持たない（本番/開発とも proxy 経由）。

export default withSentry(handler)

async function handler(req: Request): Promise<Response> {
  // fal SDK は credentials を "Authorization: Key <token>" で送ってくる（token = Supabase JWT）
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Key ') ? authHeader.slice(4)
              : authHeader?.startsWith('Bearer ') ? authHeader.slice(7)
              : null
  // 403 を返す（401 はブラウザがネイティブの Basic Auth ダイアログを出すため）
  if (!token) return jsonResponse({ error: 'Forbidden' }, 403)

  // VITE_ 変数は Edge でも参照可能。環境ごとの Supabase プロジェクトを向くよう VITE_SUPABASE_URL を使う
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const falKey = process.env.FAL_KEY
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !falKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // JWT 検証 → userId
  let userId: string | null = null
  try {
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    })
    if (!verifyRes.ok) return jsonResponse({ error: 'Forbidden' }, 403)
    const user = await verifyRes.json() as { id?: string }
    userId = user?.id ?? null
  } catch {
    return jsonResponse({ error: 'Auth verification failed' }, 500)
  }
  if (!userId) return jsonResponse({ error: 'Forbidden' }, 403)

  const admin = createClient(supabaseUrl, serviceRoleKey)
  return falProxyCore({
    admin,
    userId,
    falKey,
    method: req.method,
    targetUrl: req.headers.get(FAL_TARGET_URL_HEADER),
    contentType: req.headers.get('content-type'),
    accept: req.headers.get('accept'),
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
  })
}
