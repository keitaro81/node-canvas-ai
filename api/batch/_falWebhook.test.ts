import { describe, it, expect } from 'vitest'
import { base64urlToBytes, buildFalMessage, decodeSignature, importEd25519, verifyFalWebhook } from './_falWebhook'

// 開発用の鍵ペアで fal と同じ方式の署名を作り、検証器が正しく受理/拒否することを固定する
async function makeSigner() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey) as { x: string }
  const pub = await importEd25519(base64urlToBytes(jwk.x))
  const sign = async (requestId: string, userId: string, ts: string, body: string, encoding: 'hex' | 'b64url' = 'hex') => {
    const msg = new TextEncoder().encode(await buildFalMessage(requestId, userId, ts, body))
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, msg))
    if (encoding === 'hex') return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('')
    return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  return { pub, sign }
}

const headersOf = (h: Record<string, string>) => new Headers(h)

describe('verifyFalWebhook', () => {
  it('正しい署名（hex / base64url）を受理し、request_id を返す', async () => {
    const { pub, sign } = await makeSigner()
    const body = JSON.stringify({ request_id: 'r1', status: 'OK', payload: { a: 1 } })
    const ts = String(Math.floor(Date.now() / 1000))
    for (const enc of ['hex', 'b64url'] as const) {
      const sig = await sign('r1', 'u1', ts, body, enc)
      const res = await verifyFalWebhook(headersOf({ 'x-fal-webhook-request-id': 'r1', 'x-fal-webhook-user-id': 'u1', 'x-fal-webhook-timestamp': ts, 'x-fal-webhook-signature': sig }), body, { keys: [pub] })
      expect(res).toEqual({ ok: true, requestId: 'r1' })
    }
  })
  it('改ざん・他の鍵・古いタイムスタンプ・ヘッダ欠落を拒否する', async () => {
    const { pub, sign } = await makeSigner()
    const other = await makeSigner()
    const body = JSON.stringify({ request_id: 'r1', status: 'OK' })
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = await sign('r1', 'u1', ts, body)
    const H = (o: Partial<Record<string, string>> = {}) => headersOf({ 'x-fal-webhook-request-id': 'r1', 'x-fal-webhook-user-id': 'u1', 'x-fal-webhook-timestamp': ts, 'x-fal-webhook-signature': sig, ...o } as Record<string, string>)
    expect((await verifyFalWebhook(H(), body + ' ', { keys: [pub] })).ok).toBe(false)
    expect((await verifyFalWebhook(H(), body, { keys: [other.pub] })).ok).toBe(false)
    expect((await verifyFalWebhook(H({ 'x-fal-webhook-request-id': 'r2' }), body, { keys: [pub] })).ok).toBe(false)
    const old = String(Math.floor(Date.now() / 1000) - 600)
    const oldSig = await sign('r1', 'u1', old, body)
    expect((await verifyFalWebhook(H({ 'x-fal-webhook-timestamp': old, 'x-fal-webhook-signature': oldSig }), body, { keys: [pub] })).ok).toBe(false)
    const missing = new Headers({ 'x-fal-webhook-request-id': 'r1' })
    expect((await verifyFalWebhook(missing, body, { keys: [pub] })).ok).toBe(false)
  })
  it('decodeSignature: 128 桁 hex は hex、それ以外は base64url', () => {
    expect(decodeSignature('ab'.repeat(64)).length).toBe(64)
    expect(decodeSignature('AAEC').length).toBe(3)
  })
})
