import { describe, it, expect } from 'vitest'
import { isAllowedTarget } from './_allowlist'

describe('allowlist: LLM（openrouter/router 主・any-llm 予備）', () => {
  it('同期・キュー・requests の各 URL を許可する', () => {
    for (const u of ['https://fal.run/openrouter/router', 'https://queue.fal.run/openrouter/router', 'https://queue.fal.run/openrouter/router/requests/abc/status', 'https://fal.run/fal-ai/any-llm']) {
      expect(isAllowedTarget(new URL(u)), u).toBe(true)
    }
    expect(isAllowedTarget(new URL('https://fal.run/openrouter/other'))).toBe(false)
  })
})
