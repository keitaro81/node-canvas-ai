import { describe, it, expect } from 'vitest'
import { VIDEO_MODELS, buildVideoInput, nearestAspectRatio, resolveAspectRatio, resolveSafeDuration, resolveSafeFps, videoEndpointFor, videoModelById, videoPricePerSecond } from './videoModels'

const v3 = videoModelById('kling-v3-pro')!
const k25 = videoModelById('kling-2.5-turbo')!
const o3 = videoModelById('kling-o3-pro-i2v')!
const ltx = videoModelById('ltx-2.3-fast')!

describe('buildVideoInput（モデルごとの fal 入力・純関数）', () => {
  it('Kling v3 Pro: start/end は専用名、elements、比率は送らない、multi_prompt は prompt と排他', () => {
    const base = { prompt: 'p', model: v3.id, imageUrl: 's', endImageUrl: 'e', elements: [{ frontalUrl: 'f', referenceUrls: ['r1', 'r2', 'f'] }], audioEnabled: false }
    const input = buildVideoInput(v3, base, '3', 25, undefined)
    expect(input).toEqual({ prompt: 'p', duration: '3', start_image_url: 's', end_image_url: 'e', generate_audio: false, elements: [{ frontal_image_url: 'f', reference_image_urls: ['r1', 'r2'] }] })
    const multi = buildVideoInput(v3, { ...base, shots: [{ prompt: 'a', duration: 3 }, { prompt: 'b', duration: 4 }] }, '3', 25, undefined)
    expect(multi.prompt).toBeUndefined()
    expect(multi.multi_prompt).toEqual([{ prompt: 'p\na', duration: '3' }, { prompt: 'p\nb', duration: '4' }])
    expect(multi.duration).toBe('7')
  })
  it('Kling 2.5 / o3: image_url と終了フレームのパラメータ名、比率は渡したもの', () => {
    expect(buildVideoInput(k25, { prompt: 'p', model: k25.id, imageUrl: 's', endImageUrl: 'e' }, '5', 25, '9:16')).toEqual({ prompt: 'p', duration: '5', aspect_ratio: '9:16', image_url: 's', tail_image_url: 'e' })
    expect(buildVideoInput(o3, { prompt: 'p', model: o3.id, imageUrl: 's', endImageUrl: 'e', seed: 7 }, '5', 25, '1:1')).toEqual({ prompt: 'p', duration: '5', aspect_ratio: '1:1', image_url: 's', end_image_url: 'e', seed: 7, generate_audio: false })
  })
  it('LTX: 解像度・fps・音声の既定', () => {
    expect(buildVideoInput(ltx, { prompt: 'p', model: ltx.id, imageUrl: 's', audioEnabled: false }, '6', 25, undefined)).toEqual({ prompt: 'p', duration: 6, resolution: '1080p', fps: 25, generate_audio: false, image_url: 's' })
  })
})

describe('秒数・fps・比率の解決', () => {
  it('秒数は上限で切り、対応リストに無ければ最近傍', () => {
    expect(resolveSafeDuration(k25, '7').safeDuration).toBe('5')
    expect(resolveSafeDuration(k25, '12').safeDuration).toBe('10')
    expect(resolveSafeDuration(v3, '3').safeDuration).toBe('3')
    expect(resolveSafeDuration(ltx, undefined).safeDuration).toBe('6')
  })
  it('48/50fps は 10 秒以下のみ', () => {
    expect(resolveSafeFps(50, false, 12)).toBe(25)
    expect(resolveSafeFps(48, false, 12)).toBe(24)
    expect(resolveSafeFps(50, false, 8)).toBe(50)
    expect(resolveSafeFps(undefined, false, 8)).toBe(25)
  })
  it("比率 'auto': Kling 3.0 の i2v は送らない、他の Kling は寸法から（無ければ null = 画像を読む）、LTX は省略", () => {
    expect(resolveAspectRatio(v3, { aspectRatio: 'auto', imageUrl: 's' })).toBeUndefined()
    expect(resolveAspectRatio(k25, { aspectRatio: 'auto', imageUrl: 's' })).toBeNull()
    expect(resolveAspectRatio(k25, { aspectRatio: 'auto', imageUrl: 's' }, { width: 1000, height: 1500 })).toBe('9:16')
    expect(resolveAspectRatio(ltx, { aspectRatio: 'auto', imageUrl: 's' })).toBeUndefined()
    expect(resolveAspectRatio(k25, { aspectRatio: '16:9', imageUrl: 's' })).toBe('16:9')
  })
  it('最近傍の比率', () => {
    expect(nearestAspectRatio(1920, 1080)).toBe('16:9')
    expect(nearestAspectRatio(1000, 1500)).toBe('9:16')
    expect(nearestAspectRatio(1000, 1000)).toBe('1:1')
    expect(nearestAspectRatio(1000, 750, ['4:3', '1:1'])).toBe('4:3')
    expect(nearestAspectRatio(null, null)).toBe('16:9')
  })
  it('エンドポイント: 開始画像があれば image-to-video、参照動画系は video-to-video', () => {
    expect(videoEndpointFor(v3, { imageUrl: 's' })).toEqual({ endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', isV2V: false, isI2V: true })
    expect(videoEndpointFor(v3, {}).endpoint).toBe('fal-ai/kling-video/v3/pro/text-to-video')
    expect(videoEndpointFor(videoModelById('kling-o3-pro-v2v')!, {}).isV2V).toBe(true)
  })
})

describe('単価（fal の料金ページ 2026-11-02）と外したモデル', () => {
  it('LTX は解像度、Kling v3 Pro / o3 Pro は音声の有無で単価が変わる', () => {
    expect(videoPricePerSecond(ltx, { resolution: '1080p' })).toBe(0.06)
    expect(videoPricePerSecond(ltx, { resolution: '2160p' })).toBe(0.24)
    expect(videoPricePerSecond(v3, { audioEnabled: false })).toBe(0.112)
    expect(videoPricePerSecond(v3, { audioEnabled: true })).toBe(0.168)
    expect(videoPricePerSecond(o3, { audioEnabled: true })).toBe(0.14)
    expect(videoPricePerSecond(k25, { audioEnabled: true })).toBe(0.07)
    expect(videoPricePerSecond(videoModelById('kling-o3-standard-v2v')!)).toBe(0.126)
  })
  it('Seedance は選択肢に無い（2026-11-02 に外した）', () => {
    expect(VIDEO_MODELS.some((m) => m.id.startsWith('seedance'))).toBe(false)
    expect(videoModelById('seedance-2.0-r2v')).toBeNull()
  })
})
