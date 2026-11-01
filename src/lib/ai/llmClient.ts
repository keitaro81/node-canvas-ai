// クライアントからの LLM 呼び出し（プロキシ経由の fal.subscribe）。規則は llm.ts（サーバー api/fal/_llm.ts と共通）。
// models は先頭から順に試し、model id が無効（400/404/422）なら次の候補、エンドポイント側の失敗なら予備のエンドポイントへ
import { fal } from './fal-client'
import { LLM_ENDPOINTS, buildLlmInput, isModelRejected, readLlmResponse, type LlmRequest, type LlmResult } from './llm'

export async function llmComplete(req: Omit<LlmRequest, 'model'> & { models: readonly string[] }): Promise<LlmResult> {
  let lastErr: unknown = new Error('LLM: no endpoint')
  for (const endpoint of LLM_ENDPOINTS) {
    for (const model of req.models) {
      try {
        const res = await fal.subscribe(endpoint, { input: buildLlmInput({ ...req, model }), logs: false })
        const r = readLlmResponse((res as { data?: unknown }).data)
        if (r.error) throw new Error(`${endpoint}: ${r.error}`)
        if (!r.output) throw new Error(`${endpoint}: empty output`)
        return { output: r.output, endpoint, model, usage: r.usage }
      } catch (e) {
        lastErr = e
        if (isModelRejected((e as { status?: number }).status)) continue   // model id が無効 → 次の候補
        break                                                            // エンドポイント側の失敗 → 予備へ
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
