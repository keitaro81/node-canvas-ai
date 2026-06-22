export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'
import { withSentry } from '../_sentry'

// SSRF対策: fal.ai の生成物配信ドメイン以外はサーバーサイド fetch しない
function isAllowedSourceUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false
  return url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media')
}

// Storage パスに使うため英数字・ハイフン・アンダースコアのみ許可
const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default withSentry(handler)

async function handler(req: Request): Promise<Response> {
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

  // JWT 検証（ユーザーのトークンで認証確認）
  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { error: authError } = await userSupabase.auth.getUser(token)
  if (authError) {
    return jsonResponse({ error: 'Forbidden' }, 403)
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

  let parsedSource: URL
  try {
    parsedSource = new URL(sourceUrl)
  } catch {
    return jsonResponse({ error: 'Invalid source URL' }, 400)
  }
  if (!isAllowedSourceUrl(parsedSource)) {
    console.warn(`[save-image] rejected source host: ${parsedSource.hostname}`)
    return jsonResponse({ error: 'Source URL not allowed' }, 400)
  }
  if (!NODE_ID_PATTERN.test(nodeId)) {
    return jsonResponse({ error: 'Invalid nodeId' }, 400)
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

  const imageBlob = await imageRes.blob()

  // Supabase JS クライアント（service role key）でアップロード — sb_secret_... 形式対応
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
  const { error: uploadError } = await adminSupabase.storage
    .from('generated-images')
    .upload(path, imageBlob, { contentType, upsert: false })

  if (uploadError) {
    return jsonResponse({ error: `Storage upload failed: ${uploadError.message}` }, 502)
  }

  const { data: { publicUrl } } = adminSupabase.storage
    .from('generated-images')
    .getPublicUrl(path)

  // L2: 即時表示用に署名URLも返す（このオブジェクトは service role アップ＝owner null のため ownUrls では署名不可）
  let signedUrl: string | null = null
  try {
    const { data: signed } = await adminSupabase.storage
      .from('generated-images')
      .createSignedUrl(path, 60 * 60 * 24)
    signedUrl = signed?.signedUrl ?? null
  } catch {
    signedUrl = null
  }

  return jsonResponse({ url: publicUrl, signedUrl }, 200)
}
