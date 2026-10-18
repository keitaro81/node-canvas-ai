// fal-ai/any-llm のモデル id（2026-10-17 時点の有効一覧から）。id は入れ替わるので、保存済みの古い id はここで現行に寄せる
// （claude-haiku-4.5 は 2026-10-17 に 422 で拒否されるようになった → claude-haiku-5.5）
export const LLM_MODELS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
]
export const DEFAULT_LLM_MODEL = 'anthropic/claude-haiku-5.5'
const LEGACY: Record<string, string> = { 'anthropic/claude-haiku-4.5': 'anthropic/claude-haiku-5.5' }
/** 保存されている id を現行の id に寄せる（未知なら既定） */
export function normalizeLlmModel(id: unknown): string {
  const s = typeof id === 'string' ? id : ''
  const mapped = LEGACY[s] ?? s
  return LLM_MODELS.some((m) => m.value === mapped) ? mapped : DEFAULT_LLM_MODEL
}
