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
  it('Kling v3 Pro は動画の秒数 × 単価（音声ありは高い）、結合は無料', () => {
    expect(estimateTaskCost('fal-ai/kling-video/v3/pro/image-to-video', 120, { duration: '3' })).toBe(0.336)
    expect(estimateTaskCost('fal-ai/kling-video/v3/pro/image-to-video', null, { duration: 10 })).toBe(1.12)
    expect(estimateTaskCost('fal-ai/kling-video/v3/pro/image-to-video', null, { duration: '3', generate_audio: true })).toBe(0.504)
    expect(estimatePlannedTaskCost('fal-ai/kling-video/v3/pro/image-to-video')).toBe(0.336)   // duration 不明 → 想定 3 秒
    expect(estimateTaskCost('fal-ai/ffmpeg-api/merge-videos', 4)).toBe(0)
  })
  it('LTX は解像度で単価が変わる・Seedance は外した（2026-11-02）', () => {
    expect(estimateTaskCost('fal-ai/ltx-2.3/image-to-video/fast', null, { duration: 6, resolution: '1080p' })).toBe(0.36)
    expect(estimateTaskCost('fal-ai/ltx-2.3/image-to-video/fast', null, { duration: 6, resolution: '1440p' })).toBe(0.72)
    expect(estimateTaskCost('fal-ai/ltx-2.3/image-to-video', null, { duration: 6, resolution: '2160p' })).toBe(1.92)
    expect(pricingFor('bytedance/seedance-2.0/image-to-video')).toBeNull()
  })
})
