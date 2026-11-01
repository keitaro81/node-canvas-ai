import { describe, it, expect, beforeEach } from 'vitest'
import { clearAppPhotos, initialAppPhotos, loadAppPhotos, saveAppPhotos } from './appPhotos'
import type { BatchItem } from '../../types/nodes'

const mem = new Map<string, string>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) } }
})
const item = (id: string, status: BatchItem['status'] = 'ready'): BatchItem => ({ id, index: 1, originalName: `${id}.jpg`, sku: id, path: `t/${id}.jpg`, size: 1, status })

describe('App の写真の一覧（2026-11-02 段階 2）', () => {
  it('以前のノードの写真の一覧（2 枚以上）は一度だけ引き継ぎ、試し用の 1 枚は引き継がない', () => {
    expect(initialAppPhotos('wf:bi', [item('a'), item('b'), item('c', 'error')]).map((i) => i.id)).toEqual(['a', 'b'])
    expect(initialAppPhotos('wf:bi', [item('a'), item('b')])).toEqual([])   // 2 回目は引き継がない
    expect(initialAppPhotos('wf:bi2', [item('x')])).toEqual([])
    expect(initialAppPhotos(null, [item('a'), item('b')])).toEqual([])
  })
  it('記憶があればそれを使い、消すと空に戻る', () => {
    saveAppPhotos('wf:bi', [item('a'), item('p', 'pending')])
    expect(loadAppPhotos('wf:bi')!.map((i) => i.id)).toEqual(['a'])
    expect(initialAppPhotos('wf:bi', [item('x'), item('y')]).map((i) => i.id)).toEqual(['a'])
    clearAppPhotos('wf:bi')
    expect(loadAppPhotos('wf:bi')).toBeNull()
  })
})
