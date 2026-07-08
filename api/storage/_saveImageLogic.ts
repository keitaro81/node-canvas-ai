// save-image の共通サーバーロジック。Edge(/api/storage/save-image) と vite dev(/dev-proxy/save-image) が共用。
// service role の admin クライアントを受け取り、fal の一時URLを fetch→自前バケットへ保存→公開URL(+署名URL)を返す。
// 返り値 { status, body } を呼び出し側がそのまま HTTP 応答にする（認証は呼び出し側で実施済み前提）。
/* eslint-disable @typescript-eslint/no-explicit-any */

// SSRF対策: fal.ai の生成物配信ドメイン以外はサーバーサイド fetch しない。
export function isAllowedSourceUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false
  return url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media')
}

// Storage パスに使うため英数字・ハイフン・アンダースコアのみ許可。
export const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const IMAGE_BUCKET = 'generated-images'
const SIGNED_URL_TTL = 60 * 60 * 24

export interface SaveImageResult {
  status: number
  body: Record<string, unknown>
}

/** fal の一時URLから画像を取得し generated-images に保存、{ url, signedUrl } を返す。 */
export async function saveImageServer(
  admin: any,
  body: { sourceUrl?: string; nodeId?: string },
): Promise<SaveImageResult> {
  const { sourceUrl, nodeId } = body
  if (!sourceUrl || !nodeId) return { status: 400, body: { error: 'Missing sourceUrl or nodeId' } }

  let parsedSource: URL
  try {
    parsedSource = new URL(sourceUrl)
  } catch {
    return { status: 400, body: { error: 'Invalid source URL' } }
  }
  if (!isAllowedSourceUrl(parsedSource)) {
    console.warn(`[save-image] rejected source host: ${parsedSource.hostname}`)
    return { status: 400, body: { error: 'Source URL not allowed' } }
  }
  if (!NODE_ID_PATTERN.test(nodeId)) {
    return { status: 400, body: { error: 'Invalid nodeId' } }
  }

  const imageRes = await fetch(sourceUrl)
  if (!imageRes.ok) return { status: 502, body: { error: `Failed to fetch image: ${imageRes.status}` } }

  const rawContentType = imageRes.headers.get('content-type') ?? 'image/png'
  const isJpeg = rawContentType.includes('jpeg') || rawContentType.includes('jpg')
  const isWebp = rawContentType.includes('webp')
  const contentType = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png'
  const ext = isJpeg ? 'jpg' : isWebp ? 'webp' : 'png'
  const path = `${nodeId}/${Date.now()}.${ext}`

  // Blob は Edge / Node 18+ の両方で利用可（dev の Buffer 版と統一）。
  const imageBlob = await imageRes.blob()
  const { error: uploadError } = await admin.storage
    .from(IMAGE_BUCKET)
    .upload(path, imageBlob, { contentType, upsert: false })
  if (uploadError) return { status: 502, body: { error: `Storage upload failed: ${uploadError.message}` } }

  const { data: { publicUrl } } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(path)

  // L2: 即時表示用に署名URLも返す（service role アップ＝owner null のため ownUrls では署名不可）。
  let signedUrl: string | null = null
  try {
    const { data: signed } = await admin.storage.from(IMAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
    signedUrl = signed?.signedUrl ?? null
  } catch {
    signedUrl = null
  }

  return { status: 200, body: { url: publicUrl, signedUrl } }
}
