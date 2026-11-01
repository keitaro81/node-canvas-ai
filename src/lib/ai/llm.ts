// LLM 呼び出しの共通部（2026-11-01）。fal の `fal-ai/any-llm` が deprecated 表示（まだ動く）になったので、
// OpenRouter 経由の `openrouter/router`（トークン課金・usage.cost が返る・structured output / streaming 対応）を主に、any-llm を予備にする。
// 入力の形は両方同じ（model / prompt / system_prompt / temperature / max_tokens）、出力も { output, usage?, error? }。
// クライアント（src/lib/ai/llmClient.ts・fal.subscribe = プロキシ経由）とサーバー（api/fal/_llm.ts・fal.run）が同じ規則を使う。
// 2026-11-01 の実測: anthropic/claude-haiku-5.5 と anthropic/claude-sonnet-4.5 は openrouter/router で有効（claude-*-5.5 の sonnet/opus は 400）。
export const LLM_ENDPOINTS = ['openrouter/router', 'fal-ai/any-llm'] as const
export type LlmEndpoint = (typeof LLM_ENDPOINTS)[number]

export interface LlmRequest { model: string; prompt: string; systemPrompt?: string; temperature?: number; maxTokens?: number }
export interface LlmUsage { promptTokens: number | null; completionTokens: number | null; cost: number | null }
export interface LlmResult { output: string; endpoint: string; model: string; usage: LlmUsage }

/** fal に送る入力（any-llm / openrouter 共通の形） */
export function buildLlmInput(req: LlmRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { model: req.model, prompt: req.prompt }
  if (req.systemPrompt) input.system_prompt = req.systemPrompt
  if (typeof req.temperature === 'number') input.temperature = req.temperature
  if (typeof req.maxTokens === 'number') input.max_tokens = req.maxTokens
  return input
}

/** 応答の読み取り: output（本文）・usage（openrouter は cost を返す）・error */
export function readLlmResponse(data: unknown): { output: string; usage: LlmUsage; error: string | null } {
  const d = (data && typeof data === 'object' ? data : {}) as { output?: unknown; error?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown } }
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    output: typeof d.output === 'string' ? d.output : '',
    usage: { promptTokens: num(d.usage?.prompt_tokens), completionTokens: num(d.usage?.completion_tokens), cost: num(d.usage?.cost) },
    error: typeof d.error === 'string' && d.error ? d.error : null,
  }
}

/** model id が無効（422 / 400 / 404）なら同じエンドポイントの次の候補へ。それ以外の失敗は次のエンドポイントへ */
export const isModelRejected = (status: number | undefined): boolean => status === 422 || status === 400 || status === 404

/** ```json … ``` のコードフェンスを外す */
export function stripCodeFences(s: string): string {
  const t = s.trim()
  const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```\s*$/.exec(t)
  return (m ? m[1] : t).trim()
}

/** 前置きや後書きが混ざっていても最初の { から最後の } までを JSON として読む。読めなければ null */
export function parseJsonLoose<T = unknown>(s: string): T | null {
  const t = stripCodeFences(s)
  const candidates = [t]
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a !== -1 && b > a) candidates.push(t.slice(a, b + 1))
  for (const c of candidates) { try { return JSON.parse(c) as T } catch { /* 次 */ } }
  return null
}
