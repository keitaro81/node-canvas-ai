// 動画プロンプトの翻訳（日本語 → 英語・2026-10-17 ユーザー要望「日本語で編集し、生成時に裏で英訳」）の共通部分。
// サーバー（api/batch/_translate.ts・ジョブ作成時・fal.run）とクライアント（Video Generation の対話実行・fal.subscribe）で同じモデル候補・system prompt・整形を使う。
// 組み込みの定型文は対訳（BUILTIN_EN）を使うので LLM には来ない。英語の文はそのまま
import { builtinEnglish, hasJapanese } from './productVideo'

// model id は入れ替わる（2026-10-17: claude-haiku-4.5 は 422 → claude-haiku-5.5。2026-11-01: openrouter/router でも haiku-5.5 / sonnet-4.5 が有効）。先頭から順に試し、id 不正なら次へ
export const TRANSLATE_MODELS = ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-3-5-haiku']
export const TRANSLATE_SYSTEM_PROMPT = 'You translate Japanese text into natural, concrete English for an AI video generation prompt about a fashion model wearing a garment. Keep tokens that start with @ (such as @Element1) exactly as written. Write in the third person and present tense, describing the model (e.g. "The model stands facing the camera…"), never as an instruction to the reader. Output only the translation as one line, with no quotes, notes or alternatives. Keep any English words, numbers and @Element1 tokens exactly as they are. Do not add content that is not in the source.'

/** LLM の出力を 1 行の文に整える（引用符・改行・前置きの除去） */
export function sanitizeTranslation(s: unknown): string {
  if (typeof s !== 'string') return ''
  let t = s.trim().replace(/\s*\n+\s*/g, ' ')
  t = t.replace(/^(translation|english)\s*:\s*/i, '')
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('「') && t.endsWith('」'))) t = t.slice(1, -1).trim()
  return t
}

/** 翻訳が要る文 = 日本語で対訳の無いもの（重複なし・空は除く） */
export function textsNeedingTranslation(texts: Array<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const raw of texts) { const t = (raw ?? '').trim(); if (t && hasJapanese(t) && !builtinEnglish(t)) out.add(t) }
  return [...out]
}
