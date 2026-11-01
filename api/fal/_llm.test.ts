import { describe, it, expect } from 'vitest'
import { llmCompleteServer } from './_llm'

const fake = (handler: (url: string, body: { model: string; prompt: string }) => Response | Promise<Response>) =>
  (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), JSON.parse(String(init?.body)))) as typeof fetch

describe('llmCompleteServer（openrouter 主・any-llm 予備）', () => {
  it('model id が無効（400/422）なら同じエンドポイントの次の候補、成功したらそこで返す（usage.cost 付き）', async () => {
    const calls: string[] = []
    const r = await llmCompleteServer('key', { models: ['a', 'b'], prompt: 'p', systemPrompt: 's' }, fake((url, body) => {
      calls.push(`${url.replace('https://fal.run/', '')}:${body.model}`)
      if (body.model === 'a') return new Response('{}', { status: 400 })
      return new Response(JSON.stringify({ output: 'OUT', usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } }), { status: 200 })
    }))
    expect(r).toEqual({ output: 'OUT', endpoint: 'openrouter/router', model: 'b', usage: { promptTokens: 10, completionTokens: 5, cost: 0.0001 } })
    expect(calls).toEqual(['openrouter/router:a', 'openrouter/router:b'])
  })
  it('エンドポイント側の失敗（500 / error 応答）なら予備の any-llm へ。両方だめなら理由を並べて throw', async () => {
    const r = await llmCompleteServer('key', { models: ['a'], prompt: 'p' }, fake((url) => url.includes('openrouter') ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ output: 'FALLBACK' }), { status: 200 })))
    expect(r).toMatchObject({ output: 'FALLBACK', endpoint: 'fal-ai/any-llm', model: 'a' })
    await expect(llmCompleteServer('key', { models: ['a'], prompt: 'p' }, fake(() => new Response(JSON.stringify({ error: 'boom' }), { status: 200 })))).rejects.toThrow('LLM failed: openrouter/router: boom / fal-ai/any-llm: boom')
    await expect(llmCompleteServer('key', { models: ['a'], prompt: 'p' }, fake(() => new Response('{}', { status: 500 })))).rejects.toThrow(/500/)
  })
})
