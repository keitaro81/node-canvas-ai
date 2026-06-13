export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

const FAL_TARGET_URL_HEADER = 'x-fal-target-url'
const ALLOWED_FAL_HOSTS = ['fal.run', 'queue.fal.run', 'rest.fal.run', 'storage.fal.run', 'rest.fal.ai', 'queue.fal.ai', 'fal.ai']
const QUEUE_HOSTS = ['queue.fal.run', 'queue.fal.ai']

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * クォータ対象の生成リクエストかを判定する。
 * 対象は「生成の submit」のみ（poll/result の GET、参照画像アップロード、LLM は対象外）。
 * - method POST かつ queue ホスト
 * - /requests/ を含む（poll/result）は除外
 * - any-llm / llava（LLM）は除外
 * - path に -video を含めば動画、それ以外の生成は画像
 * 戻り値 null = クォータ非対象（素通し）。
 */
function classifyGeneration(method: string, url: URL): 'image' | 'video' | null {
  if (method !== 'POST') return null
  if (!QUEUE_HOSTS.includes(url.hostname)) return null
  const path = url.pathname
  if (path.includes('/requests/')) return null
  if (path.includes('any-llm') || path.includes('llava')) return null
  if (path.includes('-video')) return 'video'
  return 'image'
}

/** クォータの月次キー 'YYYY-MM' を JST 基準で返す（クライアントと一致させること）。 */
function currentPeriodJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 7)
}

export default async function handler(req: Request): Promise<Response> {
  // fal SDK は credentials を "Authorization: Key <token>" で送ってくる
  // PromptEnhancer の直接 fetch も同形式で送る
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Key ') ? authHeader.slice(4)
              : authHeader?.startsWith('Bearer ') ? authHeader.slice(7)
              : null

  // 403を返す（401はブラウザがネイティブのBasic Auth ダイアログを出すため）
  if (!token) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  // VITE_ 変数はクライアントバンドルに埋め込まれると同時にEdge Functionでも参照可能。
  // 環境ごとに正しいSupabaseプロジェクトを向くよう VITE_SUPABASE_URL を使う。
  // （SUPABASE_URL は All Environments で本番を向いているため beta では使えない）
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  let userId: string | null = null
  try {
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    })
    if (!verifyRes.ok) {
      return jsonResponse({ error: 'Forbidden' }, 403)
    }
    const user = await verifyRes.json() as { id?: string }
    userId = user?.id ?? null
  } catch {
    return jsonResponse({ error: 'Auth verification failed' }, 500)
  }

  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const targetUrl = req.headers.get(FAL_TARGET_URL_HEADER)
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing x-fal-target-url header' }, 400)
  }

  let parsedTarget: URL
  try {
    parsedTarget = new URL(targetUrl)
  } catch {
    return jsonResponse({ error: 'Invalid target URL' }, 400)
  }
  if (!ALLOWED_FAL_HOSTS.includes(parsedTarget.hostname)) {
    return jsonResponse({ error: 'Target URL not allowed' }, 400)
  }

  // ---- サーバー側クォータ強制（生成 submit のみ。失敗もカウント＝合意済み）----
  const kind = classifyGeneration(req.method, parsedTarget)
  if (kind) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey || !userId) {
      return jsonResponse({ error: 'Quota check unavailable' }, 500)
    }
    const admin = createClient(supabaseUrl, serviceRoleKey)

    // 所属チームを解決（バックフィル済み。未所属＝運営未登録は生成不可）
    const { data: member } = await admin
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (!member?.team_id) {
      return jsonResponse({ error: 'No team assigned' }, 403)
    }
    const teamId = member.team_id

    // チームの月次上限
    const { data: team } = await admin
      .from('teams')
      .select('quota_image_monthly, quota_video_monthly')
      .eq('id', teamId)
      .maybeSingle()
    const limit = kind === 'image' ? team?.quota_image_monthly : team?.quota_video_monthly

    // 当月のチーム合計消費（user 別行を SUM）
    const period = currentPeriodJst()
    const { data: rows } = await admin
      .from('usage_counters')
      .select('count')
      .eq('team_id', teamId)
      .eq('period', period)
      .eq('kind', kind)
    const used = (rows ?? []).reduce((s, r) => s + (r.count ?? 0), 0)

    if (limit != null && used >= limit) {
      return jsonResponse({ error: 'Quota exceeded', kind, used, limit }, 429)
    }

    // 消費を加算（atomic）。記録失敗は生成を止めず警告のみ（DB障害時の可用性優先）。
    const { error: incErr } = await admin.rpc('increment_usage_counter', {
      p_team_id: teamId,
      p_user_id: userId,
      p_period: period,
      p_kind: kind,
    })
    if (incErr) {
      console.warn('[fal proxy] increment_usage_counter failed:', incErr.message)
    }
  }

  const forwardHeaders = new Headers()
  forwardHeaders.set('Authorization', `Key ${falKey}`)
  const contentType = req.headers.get('content-type')
  if (contentType) forwardHeaders.set('Content-Type', contentType)
  const accept = req.headers.get('accept')
  if (accept) forwardHeaders.set('Accept', accept)

  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined

  const falRes = await fetch(targetUrl, {
    method: req.method,
    headers: forwardHeaders,
    body,
  })

  const responseHeaders = new Headers()
  const resContentType = falRes.headers.get('content-type')
  if (resContentType) responseHeaders.set('Content-Type', resContentType)

  return new Response(falRes.body, {
    status: falRes.status,
    headers: responseHeaders,
  })
}
