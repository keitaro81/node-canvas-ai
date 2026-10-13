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

describe('pricing（動画）', () => {
  it('Kling v3 Pro は動画の秒数 × 単価、結合は無料', () => {
    expect(estimateTaskCost('fal-ai/kling-video/v3/pro/image-to-video', 120, { duration: '3' })).toBe(0.3)
    expect(estimateTaskCost('fal-ai/kling-video/v3/pro/image-to-video', null, { duration: 10 })).toBe(1)
    expect(estimatePlannedTaskCost('fal-ai/kling-video/v3/pro/image-to-video')).toBe(0.3)   // duration 不明 → 想定 3 秒
    expect(estimateTaskCost('fal-ai/ffmpeg-api/merge-videos', 4)).toBe(0)
  })
})
