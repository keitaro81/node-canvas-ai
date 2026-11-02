import { describe, it, expect } from 'vitest'
import { effectiveVideoSettings, switchedModelNotice, videoModelsForInput } from './videoModels'
import { videoGenInputOf } from '../video/videoGenInput'

describe('入力の種類で選べるモデルと、実際に使う設定（2026-11-02 メモ 57）', () => {
  it('参照動画があれば Video to Video のモデルだけ。保存が LTX のままなら先頭に切り替え、解像度もそのモデルの値に', () => {
    const v2v = videoModelsForInput({ video: true, image: false }).map((m) => m.id)
    expect(v2v).not.toContain('ltx-2.3-fast')
    const s = effectiveVideoSettings({ model: 'ltx-2.3-fast', resolution: '1080p', aspectRatio: '16:9', duration: '6' }, { video: true, image: false })
    expect(s.model?.id).toBe(v2v[0])
    expect(s.switchedFrom?.id).toBe('ltx-2.3-fast')
    expect(s.model?.supportedResolutions).toContain(s.resolution)
    expect(switchedModelNotice(s, { video: true, image: false })).toBe(`LTX-2.3 Fast は参照動画を使えないため、${s.model?.name} で作ります（モデルの欄で選び直せます）`)
  })
  it('使えるモデルのままなら切り替えない', () => {
    const s = effectiveVideoSettings({ model: 'kling-v3-pro', resolution: '1080p', aspectRatio: '16:9', duration: '5' }, { video: false, image: true })
    expect(s.switchedFrom).toBeNull()
    expect(s.model?.id).toBe('kling-v3-pro')
    expect(switchedModelNotice(s, { video: false, image: true })).toBeNull()
  })
  it('入力の種類: 参照動画（動画のあるノード）・List の動画 / 画像・開始フレーム', () => {
    const nodes = [{ id: 'v', data: {} }, { id: 'rv', data: { videoUrl: 'https://x/a.mp4' } }, { id: 'l', data: { mode: 'video', slotCount: 1 } }, { id: 'i', data: { imageUrl: 'https://x/a.jpg' } }]
    expect(videoGenInputOf('v', nodes, [{ source: 'rv', target: 'v', targetHandle: 'in-video' }])).toEqual({ video: true, image: false })
    expect(videoGenInputOf('v', nodes, [{ source: 'l', target: 'v', targetHandle: 'in-list' }, { source: 'rv', target: 'l', targetHandle: 'in-video-0' }])).toEqual({ video: true, image: false })
    expect(videoGenInputOf('v', nodes, [{ source: 'i', target: 'v', targetHandle: 'in-image' }])).toEqual({ video: false, image: true })
  })
})
