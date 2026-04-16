export const config = { runtime: 'edge' }

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // JWT 認証
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // JWT 検証
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
  } catch {
    return jsonResponse({ error: 'Auth verification failed' }, 500)
  }

  // リクエストボディから sourceUrl と nodeId を取得
  let sourceUrl: string
  let nodeId: string
  try {
    const body = await req.json() as { sourceUrl?: string; nodeId?: string }
    if (!body.sourceUrl || !body.nodeId) throw new Error('Missing fields')
    sourceUrl = body.sourceUrl
    nodeId = body.nodeId
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  // fal.ai の一時 URL から画像を取得
  const imageRes = await fetch(sourceUrl)
  if (!imageRes.ok) {
    return jsonResponse({ error: `Failed to fetch image: ${imageRes.status}` }, 502)
  }

  const rawContentType = imageRes.headers.get('content-type') ?? 'image/png'
  const isJpeg = rawContentType.includes('jpeg') || rawContentType.includes('jpg')
  const isWebp = rawContentType.includes('webp')
  const contentType = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png'
  const ext = isJpeg ? 'jpg' : isWebp ? 'webp' : 'png'
  const path = `${nodeId}/${Date.now()}.${ext}`

  const imageBlob = await imageRes.arrayBuffer()

  // Supabase Storage に service role key でアップロード
  const uploadRes = await fetch(
    `${supabaseUrl}/storage/v1/object/generated-images/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: imageBlob,
    }
  )

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    return jsonResponse({ error: `Storage upload failed: ${err}` }, 502)
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/generated-images/${path}`
  return jsonResponse({ url: publicUrl }, 200)
}
