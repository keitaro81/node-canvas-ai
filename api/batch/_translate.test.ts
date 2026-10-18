import { describe, it, expect } from 'vitest'
import { sanitizeTranslation, translatePromptTexts } from './_translate'

describe('プロンプト翻訳（any-llm）', () => {
  it('出力を 1 行に整える（引用符・改行・前置き）', () => {
    expect(sanitizeTranslation('"Turns slowly to face the camera."')).toBe('Turns slowly to face the camera.')
    expect(sanitizeTranslation('Translation: arms relaxed\n')).toBe('arms relaxed')
    expect(sanitizeTranslation('line one\nline two')).toBe('line one line two')
    expect(sanitizeTranslation(undefined)).toBe('')
  })
  it('重複を除いて翻訳し { 原文: 英訳 } を返す。失敗は throw', async () => {
    const calls: string[] = []
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { prompt: string; model: string }
      calls.push(body.prompt)
      if (body.prompt === 'だめ') return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
      if (body.model === 'anthropic/claude-haiku-5.5' && body.prompt === '旧モデル') return new Response(JSON.stringify({ detail: [{ msg: 'literal_error' }] }), { status: 422 })   // 先頭の model が無効 → 次へ
      return new Response(JSON.stringify({ output: `EN(${body.prompt})` }), { status: 200 })
    }) as typeof fetch
    const map = await translatePromptTexts('key', ['ゆっくり回る', 'ゆっくり回る ', '腕はリラックス'], fakeFetch)
    expect(map).toEqual({ 'ゆっくり回る': 'EN(ゆっくり回る)', '腕はリラックス': 'EN(腕はリラックス)' })
    expect(calls).toHaveLength(2)
    await expect(translatePromptTexts('key', ['だめ'], fakeFetch)).rejects.toThrow('any-llm 500')
    expect(await translatePromptTexts('key', ['旧モデル'], fakeFetch)).toEqual({ '旧モデル': 'EN(旧モデル)' })   // 422 で次の候補にフォールバック
  })
})
