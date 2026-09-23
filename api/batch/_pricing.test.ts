import { describe, it, expect } from 'vitest'
import { estimatePlannedTaskCost, estimateTaskCost, pricingFor } from './_pricing'

describe('pricing', () => {
  it('固定単価・計算秒課金・未登録', () => {
    expect(estimateTaskCost('fal-ai/bria/background/remove', 5)).toBe(0.018)
    expect(estimateTaskCost('fal-ai/birefnet/v2', 2)).toBe(0.0016)
    expect(estimateTaskCost('fal-ai/birefnet/v2', null)).toBe(0.0012)   // 想定 1.5 秒
    expect(estimateTaskCost('fal-ai/unknown', 3)).toBe(0)
    expect(estimatePlannedTaskCost('fal-ai/bria/background/remove')).toBe(0.018)
  })
  it('サブパス付きエンドポイントも前方一致で解決する', () => {
    expect(pricingFor('fal-ai/nano-banana-2/edit')?.perRequestUsd).toBe(0.039)
    expect(pricingFor('fal-ai/nano-banana-2x')).toBeNull()
  })
})
