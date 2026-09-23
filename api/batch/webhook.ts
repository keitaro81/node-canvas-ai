export const config = { runtime: 'edge' }

import { withSentry, type EdgeContext } from '../_sentry'
import { adminClient, batchOpts, jsonResponse, readEnv } from './_common'
import { handleFalWebhook } from './_batchLogic'
import { clearFalKeyCache, fetchFalPublicKeys } from './_falWebhook'

// fal.ai からの完了通知（公開エンドポイント）。ログインの代わりに「ジョブの秘密値 + fal の署名」で検証する（仕様 4-5 / 8）。
// すぐ 2xx を返し、結果ファイルのコピーと DB 反映は応答後（waitUntil）に行う。
export default withSentry(async (req: Request, ctx?: EdgeContext): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const env = readEnv()
  if (!env) return jsonResponse({ error: 'Server configuration error' }, 500)
  const admin = adminClient(env)
  const opts = batchOpts(env, null)
  let keys = await fetchFalPublicKeys()
  let res = await handleFalWebhook(admin, { ...opts, keys }, req.clone(), ctx ?? {})
  if (res.status === 401) {
    // 鍵ローテーション対策: JWKS を取り直して 1 回だけ再検証
    clearFalKeyCache()
    keys = await fetchFalPublicKeys()
    res = await handleFalWebhook(admin, { ...opts, keys }, req, ctx ?? {})
  }
  return res
})
