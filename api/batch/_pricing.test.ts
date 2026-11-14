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
    expect(pricingFor('google/nano-banana-2.1/edit')?.perRequestUsd).toBe(0.044)
    expect(pricingFor('fal-ai/nano-banana-2/edit')?.perRequestUsd).toBe(0.08)   // 旧モデル（古いタスクの実績用）
    expect(pricingFor('fal-ai/nano-banana-2x')).toBeNull()
    // GPT Image 2.6 は 2 の表に誤って当たらない（'openai/gpt-image-2' + '/' でないので別の行）
    expect(pricingFor('openai/gpt-image-2.6/flare/edit')?.perRequestUsd).toBe(0.19)
    expect(pricingFor('openai/gpt-image-2.6/sunburst/text-to-image')?.perRequestUsd).toBe(0.19)
    expect(pricingFor('openai/gpt-image-2/edit')?.perRequestUsd).toBe(0.05)
  })
  it('Nano Banana は解像度で単価が変わる（2.1: 1K $0.044 / 2K $0.063 / 4K $0.138）。解像度が分からなければ 1K の額', () => {
    expect(estimateTaskCost('google/nano-banana-2.1/edit', null, { resolution: '2K' })).toBe(0.063)   // 試着の既定（2K）
    expect(estimateTaskCost('google/nano-banana-2.1/edit', null, { resolution: '4K' })).toBe(0.138)
    expect(estimateTaskCost('google/nano-banana-2.1', null, { resolution: '1K' })).toBe(0.044)
    expect(estimateTaskCost('google/nano-banana-2.1', null, {})).toBe(0.044)
    expect(estimatePlannedTaskCost('google/nano-banana-2.1/edit', { resolution: '2K' })).toBe(0.063)
    expect(estimateTaskCost('fal-ai/nano-banana-2/edit', null, { resolution: '2K' })).toBe(0.12)      // 旧モデルの 2K
    expect(estimateTaskCost('fal-ai/nano-banana-pro/edit', null, { resolution: '2K' })).toBe(0.15)    // 表に解像度別が無いものは固定の額
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
