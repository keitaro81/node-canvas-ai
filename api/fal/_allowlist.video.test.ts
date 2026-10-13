import { describe, expect, it } from 'vitest'
import { isAllowedTarget } from './_allowlist'

describe('allowlist（商品動画）', () => {
  it('Kling v3 の画像から動画と ffmpeg の結合（キュー投入・状態・結果）を許可する', () => {
    expect(isAllowedTarget(new URL('https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video'))).toBe(true)
    expect(isAllowedTarget(new URL('https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos'))).toBe(true)
    expect(isAllowedTarget(new URL('https://queue.fal.run/fal-ai/ffmpeg-api/requests/abc/status'))).toBe(true)
    expect(isAllowedTarget(new URL('https://queue.fal.run/fal-ai/ffmpeg-api/requests/abc'))).toBe(true)
    expect(isAllowedTarget(new URL('https://queue.fal.run/bytedance/seedance-2.0/reference-to-video'))).toBe(false)   // 未導入
  })
})
