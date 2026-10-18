// 商品動画のプロンプト翻訳（日本語 → 英語・2026-10-17 ユーザー要望「日本語で編集し、生成時に裏で英訳」）。
// fal の any-llm（Claude Haiku 4.5）を同期エンドポイント fal.run で呼ぶ。英語の文はここに来ない（呼び出し側 promptTextsToTranslate が日本語だけ渡す）。
// 組み込みの定型文は対訳（BUILTIN_EN）を使うので LLM には来ない。失敗したらジョブ作成を止める（日本語のまま Kling に送らない）
import { isAllowedTarget } from '../fal/_allowlist'

// any-llm の model id は入れ替わる（2026-10-17 時点: claude-haiku-4.5 は 422、claude-haiku-5.5 が最新）。先頭から順に試し、422（id 不正）なら次へ
export const TRANSLATE_MODELS = ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-3-5-haiku']
const SYSTEM_PROMPT = 'You translate Japanese text into natural, concrete English for an AI video generation prompt about a fashion model wearing a garment. Write in the third person and present tense, describing the model (e.g. "The model stands facing the camera…"), never as an instruction to the reader. Output only the translation as one line, with no quotes, notes or alternatives. Keep any English words, numbers and @Element1 tokens exactly as they are. Do not add content that is not in the source.'

/** LLM の出力を 1 行の文に整える（引用符・改行・前置きの除去） */
export function sanitizeTranslation(s: unknown): string {
  if (typeof s !== 'string') return ''
  let t = s.trim().replace(/\s*\n+\s*/g, ' ')
  t = t.replace(/^(translation|english)\s*:\s*/i, '')
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('「') && t.endsWith('」'))) t = t.slice(1, -1).trim()
  return t
}

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
