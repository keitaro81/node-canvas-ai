// fal.ai Webhook の署名検証（fal docs: Webhooks）。
//   ヘッダ: X-Fal-Webhook-Request-Id / X-Fal-Webhook-User-Id / X-Fal-Webhook-Timestamp / X-Fal-Webhook-Signature
//   メッセージ: request_id, user_id, timestamp, SHA-256(body) の hex を改行で連結
//   署名: ED25519。公開鍵は JWKS（https://rest.fal.ai/.well-known/jwks.json、x = base64url の生鍵）
//   タイムスタンプの許容: ±5 分

// Edge/Node 双方で使う WebCrypto の鍵型（tsconfig の lib に DOM が無い環境でも解決できるように推論で定義）
export type WebCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>

export const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json'
export const FAL_WEBHOOK_LEEWAY_SEC = 300
const JWKS_TTL_MS = 24 * 60 * 60 * 1000

export interface FalWebhookBody {
  request_id?: string
  gateway_request_id?: string
  status?: string              // 'OK' | 'ERROR'
  payload?: unknown
  error?: string
  payload_error?: string
}

export function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? '0' + hex : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 署名ヘッダは hex（fal の参考実装）を第一候補に、base64url も受け付ける。 */
export function decodeSignature(sig: string): Uint8Array {
  const s = sig.trim()
  if (/^[0-9a-fA-F]+$/.test(s) && s.length === 128) return hexToBytes(s)
  return base64urlToBytes(s)
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function importEd25519(rawPublicKey: Uint8Array): Promise<WebCryptoKey> {
  return crypto.subtle.importKey('raw', rawPublicKey as unknown as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'])
}

let jwksCache: { keys: WebCryptoKey[]; at: number } | null = null

/** fal の公開鍵（JWKS）を取得して 24 時間キャッシュする。 */
export async function fetchFalPublicKeys(fetchImpl: typeof fetch = fetch): Promise<WebCryptoKey[]> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys
  const res = await fetchImpl(FAL_JWKS_URL)
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
  const json = await res.json() as { keys?: Array<{ kty?: string; crv?: string; x?: string }> }
  const keys: WebCryptoKey[] = []
  for (const k of json.keys ?? []) {
    if (!k.x) continue
    try { keys.push(await importEd25519(base64urlToBytes(k.x))) } catch { /* 対応外の鍵は無視 */ }
  }
  if (!keys.length) throw new Error('JWKS has no usable keys')
  jwksCache = { keys, at: Date.now() }
  return keys
}

/** キャッシュを捨てる（鍵ローテーション時に検証失敗したら 1 回だけ取り直す用）。 */
export function clearFalKeyCache(): void {
  jwksCache = null
}

export type VerifyResult = { ok: true; requestId: string } | { ok: false; reason: string }

/** 署名メッセージを組み立てる（テストと本体で共用）。 */
export async function buildFalMessage(requestId: string, userId: string, timestamp: string, rawBody: string): Promise<string> {
  return [requestId, userId, timestamp, await sha256Hex(rawBody)].join('\n')
}

export async function verifyFalWebhook(
  headers: Headers,
  rawBody: string,
  opts: { keys: WebCryptoKey[]; nowSec?: number; leewaySec?: number },
): Promise<VerifyResult> {
  const requestId = headers.get('x-fal-webhook-request-id')
  const userId = headers.get('x-fal-webhook-user-id')
  const timestamp = headers.get('x-fal-webhook-timestamp')
  const signature = headers.get('x-fal-webhook-signature')
  if (!requestId || !userId || !timestamp || !signature) return { ok: false, reason: 'missing headers' }
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' }
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > (opts.leewaySec ?? FAL_WEBHOOK_LEEWAY_SEC)) return { ok: false, reason: 'timestamp out of range' }
  let sigBytes: Uint8Array
  try { sigBytes = decodeSignature(signature) } catch { return { ok: false, reason: 'bad signature encoding' } }
  const message = new TextEncoder().encode(await buildFalMessage(requestId, userId, timestamp, rawBody))
  for (const key of opts.keys) {
    try {
      if (await crypto.subtle.verify('Ed25519', key, sigBytes as unknown as ArrayBuffer, message)) return { ok: true, requestId }
    } catch { /* 次の鍵 */ }
  }
  return { ok: false, reason: 'signature mismatch' }
}
