// 商品動画のプロンプト翻訳（日本語 → 英語・2026-10-17 ユーザー要望「日本語で編集し、生成時に裏で英訳」）。
// fal の any-llm（Claude Haiku 4.5）を同期エンドポイント fal.run で呼ぶ。英語の文はここに来ない（呼び出し側 promptTextsToTranslate が日本語だけ渡す）。
// 組み込みの定型文は対訳（BUILTIN_EN）を使うので LLM には来ない。失敗したらジョブ作成を止める（日本語のまま Kling に送らない）
import { isAllowedTarget } from '../fal/_allowlist'
import { TRANSLATE_MODELS, TRANSLATE_SYSTEM_PROMPT as SYSTEM_PROMPT, sanitizeTranslation } from '../../src/lib/video/translate'

export { TRANSLATE_MODELS, sanitizeTranslation } from '../../src/lib/video/translate'

export async function translateOne(falKey: string, text: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = 'https://fal.run/fal-ai/any-llm'
  if (!isAllowedTarget(new URL(url))) throw new Error('fal target not allowed: any-llm')
  let lastErr = 'any-llm: no model'
  for (const model of TRANSLATE_MODELS) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, system_prompt: SYSTEM_PROMPT, prompt: text }),
    })
    if (res.status === 422) { lastErr = `any-llm 422 (${model})`; continue }   // model id が無効 → 次の候補
    if (!res.ok) throw new Error(`any-llm ${res.status}`)
    const j = (await res.json().catch(() => null)) as { output?: string; error?: string } | null
    const out = sanitizeTranslation(j?.output)
    if (!out) throw new Error(j?.error ? `any-llm: ${j.error}` : 'any-llm: empty output')
    return out
  }
  throw new Error(lastErr)
}

/** 重複を除いて並列に翻訳し、{ 原文: 英訳 } を返す。1 つでも失敗したら throw */
export async function translatePromptTexts(falKey: string, texts: string[], fetchImpl?: typeof fetch): Promise<Record<string, string>> {
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
  const pairs = await Promise.all(uniq.map(async (t) => [t, await translateOne(falKey, t, fetchImpl)] as const))
  return Object.fromEntries(pairs)
}
