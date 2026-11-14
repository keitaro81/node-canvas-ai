// サーバー（Edge / vite dev）からの LLM 呼び出し（fal.run 同期・FAL_KEY）。規則は src/lib/ai/llm.ts（クライアントと共通）。
// models は先頭から順に試し、model id が無効（400/404/422）なら次の候補、エンドポイント側の失敗なら予備のエンドポイントへ
// 依頼には api/fal/_privacy.ts のヘッダーを付ける（メモ 83。既定は生成物ファイルの期限だけ。FAL_STORE_IO=0 にすると、プロンプトや翻訳する文も fal の履歴に残さない）
import { isAllowedTarget } from './_allowlist'
import { falPrivacyHeaders } from './_privacy'
import { LLM_ENDPOINTS, buildLlmInput, isModelRejected, readLlmResponse, type LlmRequest, type LlmResult } from '../../src/lib/ai/llm'

export async function llmCompleteServer(falKey: string, req: Omit<LlmRequest, 'model'> & { models: readonly string[] }, fetchImpl: typeof fetch = fetch): Promise<LlmResult> {
  const errors: string[] = []
  for (const endpoint of LLM_ENDPOINTS) {
    const url = `https://fal.run/${endpoint}`
    if (!isAllowedTarget(new URL(url))) { errors.push(`${endpoint}: not allowed`); continue }
    for (const model of req.models) {
      const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json', ...falPrivacyHeaders() }, body: JSON.stringify(buildLlmInput({ ...req, model })) })
      if (isModelRejected(res.status)) { errors.push(`${endpoint} ${res.status} (${model})`); continue }
      if (!res.ok) { errors.push(`${endpoint} ${res.status}`); break }
      const r = readLlmResponse(await res.json().catch(() => null))
      if (r.error || !r.output) { errors.push(`${endpoint}: ${r.error ?? 'empty output'}`); break }
      return { output: r.output, endpoint, model, usage: r.usage }
    }
  }
  throw new Error(`LLM failed: ${errors.join(' / ')}`)
}
