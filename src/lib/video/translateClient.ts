// クライアントからの翻訳（Video Generation / Try-On の対話実行）: LLM をプロキシ経由で呼ぶ（llmClient）。規則はサーバーと同じ（translate.ts）
import { llmComplete } from '../ai/llmClient'
import { TRANSLATE_MODELS, TRANSLATE_SYSTEM_PROMPT, sanitizeTranslation } from './translate'

async function translateOne(text: string): Promise<string> {
  const r = await llmComplete({ models: TRANSLATE_MODELS, systemPrompt: TRANSLATE_SYSTEM_PROMPT, prompt: text })
  const out = sanitizeTranslation(r.output)
  if (!out) throw new Error(`${r.endpoint}: empty output`)
  return out
}

/** 重複を除いて並列に翻訳し、{ 原文: 英訳 } を返す。1 つでも失敗したら throw */
export async function translateTextsClient(texts: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
  const pairs = await Promise.all(uniq.map(async (t) => [t, await translateOne(t)] as const))
  return Object.fromEntries(pairs)
}
