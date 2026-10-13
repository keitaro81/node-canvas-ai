import { describe, expect, it } from 'vitest'
import { buildKlingElements, buildMultiPrompt, cutsToElement, shotsTotalSeconds } from './videoShots'

describe('cutsToElement', () => {
  const cuts = [{ nodeId: 'a', url: 'A' }, { nodeId: 'b', url: 'B' }, { nodeId: 'c', url: 'C' }, { nodeId: 'd', url: 'D' }, { nodeId: 'e', url: 'E' }]
  it('正面は指定ノード（無ければ先頭）、別角度は最大 3、溢れは数える', () => {
    expect(cutsToElement(cuts, 'c')).toEqual({ element: { frontalUrl: 'C', referenceUrls: ['A', 'B', 'D'] }, ignored: 1 })
    expect(cutsToElement(cuts.slice(0, 2), null)).toEqual({ element: { frontalUrl: 'A', referenceUrls: ['B'] }, ignored: 0 })
    expect(cutsToElement(cuts.slice(0, 1), 'zzz')).toEqual({ element: { frontalUrl: 'A', referenceUrls: [] }, ignored: 0 })
  })
  it('URL の無いカットと重複は除く、空なら null', () => {
    expect(cutsToElement([{ nodeId: 'a', url: '' }], null)).toEqual({ element: null, ignored: 0 })
    expect(cutsToElement([{ nodeId: 'a', url: 'A' }, { nodeId: 'b', url: 'A' }], null).element).toEqual({ frontalUrl: 'A', referenceUrls: [] })
  })
})

describe('buildKlingElements', () => {
  it('API の形にし、参照が無ければ reference_image_urls を省く', () => {
    expect(buildKlingElements([{ frontalUrl: 'F', referenceUrls: ['R1', 'R1', 'F', 'R2', 'R3', 'R4'] }, { frontalUrl: '', referenceUrls: ['x'] }, { frontalUrl: 'G', referenceUrls: [] }]))
      .toEqual([{ frontal_image_url: 'F', reference_image_urls: ['R1', 'R2', 'R3'] }, { frontal_image_url: 'G' }])
  })
})

describe('buildMultiPrompt', () => {
  it('共通プロンプトを各ショットに前置し、秒数を丸めて合計を 3〜15 に収める', () => {
    const r = buildMultiPrompt([{ prompt: ' turn ', duration: 2 }, { prompt: 'walk', duration: 20 }, { prompt: '  ', duration: 5 }], 'Base. ')
    expect(r).toEqual({ multi_prompt: [{ prompt: 'Base.\nturn', duration: '2' }, { prompt: 'Base.\nwalk', duration: '15' }], duration: '15' })
    expect(buildMultiPrompt([{ prompt: 'a', duration: 1 }], '')).toEqual({ multi_prompt: [{ prompt: 'a', duration: '1' }], duration: '3' })
    expect(buildMultiPrompt([], 'x')).toBeNull()
    expect(buildMultiPrompt(undefined, 'x')).toBeNull()
  })
  it('合計秒数の表示', () => {
    expect(shotsTotalSeconds([{ prompt: 'a', duration: 3 }, { prompt: 'b', duration: 4.4 }])).toBe(7)
    expect(shotsTotalSeconds(undefined)).toBe(0)
  })
})
