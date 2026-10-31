// クライアントからの翻訳（Video Generation の対話実行）: fal の any-llm をプロキシ経由（fal.subscribe）で呼ぶ。規則はサーバーと同じ（translate.ts）
import { fal } from '../ai/fal-client'
import { TRANSLATE_MODELS, TRANSLATE_SYSTEM_PROMPT, sanitizeTranslation } from './translate'

async function translateOne(text: string): Promise<string> {
  let lastErr: unknown = new Error('any-llm: no model')
  for (const model of TRANSLATE_MODELS) {
    try {
      const res = await fal.subscribe('fal-ai/any-llm', { input: { model, system_prompt: TRANSLATE_SYSTEM_PROMPT, prompt: text } })
      const out = sanitizeTranslation((res as { data?: { output?: unknown } }).data?.output)
      if (out) return out
      throw new Error('any-llm: empty output')
    } catch (e) {
      lastErr = e
      if ((e as { status?: number }).status === 422) continue   // model id が無効 → 次の候補
      throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 重複を除いて並列に翻訳し、{ 原文: 英訳 } を返す。1 つでも失敗したら throw */
export async function translateTextsClient(texts: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
  const pairs = await Promise.all(uniq.map(async (t) => [t, await translateOne(t)] as const))
  return Object.fromEntries(pairs)
}
