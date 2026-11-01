// 商品動画・試着のプロンプト翻訳（日本語 → 英語・2026-10-17 ユーザー要望「日本語で編集し、生成時に裏で英訳」）。
// LLM はサーバー共通の llmCompleteServer（openrouter/router 主・any-llm 予備・fal.run 同期）で呼ぶ。英語の文はここに来ない（呼び出し側 promptTextsToTranslate が日本語だけ渡す）。
// 組み込みの定型文は対訳（BUILTIN_EN）を使うので LLM には来ない。失敗したらジョブ作成を止める（日本語のまま Kling に送らない）
import { llmCompleteServer } from '../fal/_llm'
import { TRANSLATE_MODELS, TRANSLATE_SYSTEM_PROMPT as SYSTEM_PROMPT, sanitizeTranslation } from '../../src/lib/video/translate'

export { TRANSLATE_MODELS, sanitizeTranslation } from '../../src/lib/video/translate'

export async function translateOne(falKey: string, text: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await llmCompleteServer(falKey, { models: TRANSLATE_MODELS, systemPrompt: SYSTEM_PROMPT, prompt: text }, fetchImpl)
  const out = sanitizeTranslation(r.output)
  if (!out) throw new Error(`${r.endpoint}: empty output`)
  return out
}

/** 重複を除いて並列に翻訳し、{ 原文: 英訳 } を返す。1 つでも失敗したら throw */
export async function translatePromptTexts(falKey: string, texts: string[], fetchImpl?: typeof fetch): Promise<Record<string, string>> {
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
  const pairs = await Promise.all(uniq.map(async (t) => [t, await translateOne(falKey, t, fetchImpl)] as const))
  return Object.fromEntries(pairs)
}
