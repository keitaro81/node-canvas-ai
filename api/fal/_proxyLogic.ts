// fal プロキシの共通コア。Edge(/api/fal/proxy) と vite dev(/dev-proxy/fal) が共用（認証は呼び出し側で実施済み前提）。
// 役割: 対象URLの allowlist 検査 → 生成 submit ならサーバー側クォータ強制 → サーバー側 FAL_KEY で fal へ転送。
// 返り値は Web 標準の Response（Edge はそのまま返し、dev は node の res に写す）。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAllowedTarget, isBgRemovalPath, modelPathOf } from './_allowlist'

export const FAL_TARGET_URL_HEADER = 'x-fal-target-url'

const QUEUE_OR_SYNC_HOSTS = ['queue.fal.run', 'queue.fal.ai', 'fal.run', 'fal.ai']

export function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * クォータ対象の生成リクエストかを判定する（生成 submit のみ）。
 * - POST かつ生成実行ホスト（queue.* または同期 fal.run/fal.ai）
 * - /requests/（poll/result/cancel）・LLM（any-llm/llava）は対象外
 * - 背景切り抜き（撮影後工程）は月次画像クォータと別建てのため対象外（バッチ側の上限で制御）
 * - path に -video を含めば動画、それ以外は画像
 */
export function classifyGeneration(method: string, url: URL): 'image' | 'video' | null {
  if (method !== 'POST') return null
  if (!QUEUE_OR_SYNC_HOSTS.includes(url.hostname)) return null
  const path = modelPathOf(url)
  if (path.includes('/requests/')) return null
  if (path.includes('any-llm') || path.includes('llava')) return null
  if (isBgRemovalPath(path)) return null
  if (path.includes('-video')) return 'video'
  return 'image'
}

/** クォータの月次キー 'YYYY-MM'（JST）。api/team/_teamLogic.ts / src/lib/api/teams.ts と一致させること。 */
export function currentPeriodJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 7)
}

export interface FalProxyInput {
  admin: any               // service role クライアント（クォータ判定・記帳用）
  userId: string           // 検証済み JWT の uid
  falKey: string           // サーバー側の fal 鍵
  method: string
  targetUrl: string | null // x-fal-target-url
  contentType?: string | null
  accept?: string | null
  body?: string
}

export async function falProxyCore(input: FalProxyInput): Promise<Response> {
  const { admin, userId, falKey, method, targetUrl, contentType, accept, body } = input
  if (!targetUrl) return jsonResponse({ error: `Missing ${FAL_TARGET_URL_HEADER} header` }, 400)

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return jsonResponse({ error: 'Invalid target URL' }, 400)
  }
  if (!isAllowedTarget(parsed)) return jsonResponse({ error: 'Target URL not allowed' }, 400)

  // ---- サーバー側クォータ強制（生成 submit のみ。失敗もカウント＝合意済み）----
  const kind = classifyGeneration(method, parsed)
  if (kind) {
    const { data: member } = await admin.from('team_members').select('team_id').eq('user_id', userId).limit(1).maybeSingle()
    if (!member?.team_id) return jsonResponse({ error: 'No team assigned' }, 403)
    const teamId = member.team_id

    const { data: team } = await admin
      .from('teams').select('quota_image_monthly, quota_video_monthly').eq('id', teamId).maybeSingle()
    const limit = kind === 'image' ? team?.quota_image_monthly : team?.quota_video_monthly

    const period = currentPeriodJst()
    const { data: rows } = await admin
      .from('usage_counters').select('count').eq('team_id', teamId).eq('period', period).eq('kind', kind)
    const used = ((rows ?? []) as Array<{ count: number | null }>).reduce((s, r) => s + (r.count ?? 0), 0)
    if (limit != null && used >= limit) return jsonResponse({ error: 'Quota exceeded', kind, used, limit }, 429)

    // 消費を加算（atomic）。記録失敗は生成を止めず警告のみ（DB障害時の可用性優先）
    const { error: incErr } = await admin.rpc('increment_usage_counter', {
      p_team_id: teamId, p_user_id: userId, p_period: period, p_kind: kind,
    })
    if (incErr) console.warn('[fal proxy] increment_usage_counter failed:', incErr.message)
  }

  // ---- fal へ転送（鍵はここでのみ付与）----
  const forwardHeaders = new Headers()
  forwardHeaders.set('Authorization', `Key ${falKey}`)
  if (contentType) forwardHeaders.set('Content-Type', contentType)
  if (accept) forwardHeaders.set('Accept', accept)

  const falRes = await fetch(targetUrl, {
    method,
    headers: forwardHeaders,
    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
  })
  const responseHeaders = new Headers()
  const resContentType = falRes.headers.get('content-type')
  if (resContentType) responseHeaders.set('Content-Type', resContentType)
  return new Response(falRes.body, { status: falRes.status, headers: responseHeaders })
}
