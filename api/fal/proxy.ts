export const config = { runtime: 'edge' }

const FAL_TARGET_URL_HEADER = 'x-fal-target-url'
const ALLOWED_FAL_HOSTS = ['fal.run', 'queue.fal.run', 'rest.fal.run']

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  // 1. fal クライアントが "Authorization: Key <token>" で送ってくるトークンを取り出す
  //    本番では token = Supabase JWT、開発では VITE_FAL_KEY をそのまま送ってくるだけ
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Key ') ? authHeader.slice(4) : null

  if (!token) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // 2. Supabase でトークンを検証（ログイン済みユーザーのみ通す）
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  try {
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    })
    if (!verifyRes.ok) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401)
    }
  } catch {
    return jsonResponse({ error: 'Auth verification failed' }, 500)
  }

  // 3. fal クライアントが x-fal-target-url ヘッダーで実際の宛先 URL を指定してくる
  const targetUrl = req.headers.get(FAL_TARGET_URL_HEADER)
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing x-fal-target-url header' }, 400)
  }

  // 4. SSRF 対策：fal.ai のドメインのみ許可
  let parsedTarget: URL
  try {
    parsedTarget = new URL(targetUrl)
  } catch {
    return jsonResponse({ error: 'Invalid target URL' }, 400)
  }
  if (!ALLOWED_FAL_HOSTS.includes(parsedTarget.hostname)) {
    return jsonResponse({ error: 'Target URL not allowed' }, 400)
  }

  // 5. サーバーサイドの FAL_KEY を付けて fal.ai に転送
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
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
