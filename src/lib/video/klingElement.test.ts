import { describe, it, expect } from 'vitest'
import { elementNumberOfHandle, klingElementImages, videoGenElements, withElementTag } from './klingElement'

const img = (id: string) => ({ id, type: 'referenceImageNode', data: { type: 'referenceImage', imageUrl: `https://x/${id}.jpg` } })
const el = (id: string) => ({ id, type: 'klingElementNode', data: { type: 'klingElement', label: 'Kling Element', params: {}, status: 'idle' } })
const vg = (id: string) => ({ id, type: 'videoGenerationNode', data: { type: 'videoGen', params: {} } })
const e = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })

describe('Kling Element（参照一式・2026-11-02 メモ 42）', () => {
  it('Kling Element の写真: 正面と別角度（正面と同じ写真は除く）', () => {
    const nodes = [img('f'), img('r'), img('l'), el('k')]
    const edges = [e('f', 'out-image', 'k', 'in-image-frontal'), e('r', 'out-image', 'k', 'in-image-ref1'), e('f', 'out-image', 'k', 'in-image-ref2'), e('l', 'out-image', 'k', 'in-image-ref3')]
    expect(klingElementImages(nodes, edges, 'k')).toEqual({ frontal: 'https://x/f.jpg', refs: ['https://x/r.jpg', 'https://x/l.jpg'] })
  })
  it('Video Generation の参照一式: 1 から続く分だけ送る。写真が足りない一式は送らず、2 だけなどは gap', () => {
    const nodes = [img('f'), img('r'), el('k1'), el('k2'), el('k3'), vg('v'), vg('w')]
    const full = [e('f', 'out-image', 'k1', 'in-image-frontal'), e('r', 'out-image', 'k1', 'in-image-ref1'), e('f', 'out-image', 'k2', 'in-image-frontal')]
    const toV = [e('k1', 'out-element-element', 'v', 'in-element-1'), e('k2', 'out-element-element', 'v', 'in-element-2')]
    const r = videoGenElements(nodes, [...full, ...toV], 'v')
    expect(r.elements).toEqual([{ frontalUrl: 'https://x/f.jpg', referenceUrls: ['https://x/r.jpg'] }])
    expect(r.connected).toEqual([1, 2])
    expect(r.incomplete).toEqual([2])   // k2 は正面だけ（写真が足りない・番号は続いている）
    expect(r.gap).toBe(false)
    const onlyTwo = videoGenElements(nodes, [...full, e('k1', 'out-element-element', 'w', 'in-element-2')], 'w')
    expect(onlyTwo.elements).toEqual([])
    expect(onlyTwo.gap).toBe(true)
    expect(videoGenElements(nodes, full, 'v')).toEqual({ elements: [], connected: [], incomplete: [], gap: false })
  })
  it('@ElementN を「動き」の先頭の @Element 行の並びに 1 行で入れる（書いてあれば何もしない）', () => {
    expect(withElementTag('', 1)).toBe('@Element1')
    expect(withElementTag('ゆっくり回る', 1)).toBe('@Element1\nゆっくり回る')
    expect(withElementTag('@Element1\nゆっくり回る', 2)).toBe('@Element1\n@Element2\nゆっくり回る')
    expect(withElementTag('@Element1 がゆっくり回る', 1)).toBe('@Element1 がゆっくり回る')
    expect(elementNumberOfHandle('in-element-3')).toBe(3)
    expect(elementNumberOfHandle('in-image')).toBeNull()
  })
})
