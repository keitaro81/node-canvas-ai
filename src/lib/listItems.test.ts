import { describe, it, expect } from 'vitest'
import { listItemsOf } from './listItems'

const list = (mode: string, slotCount: number) => ({ id: 'L', data: { label: 'List', mode, slotCount } })
const e = (source: string, target: string, targetHandle: string) => ({ source, sourceHandle: null, target, targetHandle })

describe('listItemsOf（List の中身・2026-11-02 メモ 40）', () => {
  it('動画・画像・テキストをスロット順に集め、空のスロットは飛ばす', () => {
    const vids = [{ id: 'v1', data: { videoUrl: 'https://x/1.mp4' } }, { id: 'v2', data: { videoUrl: null } }, { id: 'v3', data: { videoUrl: 'https://x/3.mp4' } }]
    expect(listItemsOf([list('video', 3), ...vids], [e('v1', 'L', 'in-video-0'), e('v2', 'L', 'in-video-1'), e('v3', 'L', 'in-video-2')], 'L')).toEqual({ mode: 'video', items: ['https://x/1.mp4', 'https://x/3.mp4'] })
    const imgs = [{ id: 'i1', data: { imageUrl: 'https://x/a.jpg' } }]
    expect(listItemsOf([list('image', 2), ...imgs], [e('i1', 'L', 'in-image-1')], 'L')).toEqual({ mode: 'image', items: ['https://x/a.jpg'] })
    const texts = [{ id: 't1', data: { params: { prompt: ' ゆっくり回る ' } } }, { id: 't2', data: { outputText: 'zoom in' } }]
    expect(listItemsOf([list('text', 2), ...texts], [e('t1', 'L', 'in-text-0'), e('t2', 'L', 'in-text-1')], 'L')).toEqual({ mode: 'text', items: ['ゆっくり回る', 'zoom in'] })
  })
  it('モードが未確定・List が無いときは項目なし', () => {
    expect(listItemsOf([list('unset', 2)], [], 'L')).toEqual({ mode: 'unset', items: [] })
    expect(listItemsOf([], [], 'L')).toEqual({ mode: 'unset', items: [] })
  })
})
