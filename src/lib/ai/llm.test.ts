import { describe, it, expect } from 'vitest'
import { buildLlmInput, isModelRejected, parseJsonLoose, readLlmResponse, stripCodeFences } from './llm'

describe('LLM 共通部', () => {
  it('入力は model / prompt を必ず、system_prompt / temperature / max_tokens はあるときだけ', () => {
    expect(buildLlmInput({ model: 'm', prompt: 'p' })).toEqual({ model: 'm', prompt: 'p' })
    expect(buildLlmInput({ model: 'm', prompt: 'p', systemPrompt: 's', temperature: 0, maxTokens: 10 })).toEqual({ model: 'm', prompt: 'p', system_prompt: 's', temperature: 0, max_tokens: 10 })
  })
  it('応答の読み取り: output と usage.cost、error', () => {
    expect(readLlmResponse({ output: 'hi', usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.00001 } })).toEqual({ output: 'hi', usage: { promptTokens: 3, completionTokens: 2, cost: 0.00001 }, error: null })
    expect(readLlmResponse({ output: '', error: 'boom' })).toMatchObject({ output: '', error: 'boom', usage: { cost: null } })
    expect(readLlmResponse(null).output).toBe('')
  })
  it('model id が無効な応答コードだけ次の候補へ', () => {
    expect([400, 404, 422].every(isModelRejected)).toBe(true)
    expect([500, 502, 200, undefined].some(isModelRejected)).toBe(false)
  })
  it('コードフェンスと前置きがあっても JSON を読む', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(parseJsonLoose('```json\n{"ok":true}\n```')).toEqual({ ok: true })
    expect(parseJsonLoose('はい、こちらです。\n{"a":{"b":[1,2]}}\n以上')).toEqual({ a: { b: [1, 2] } })
    expect(parseJsonLoose('not json')).toBeNull()
  })
})
