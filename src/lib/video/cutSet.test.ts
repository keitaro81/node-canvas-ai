import { describe, it, expect } from 'vitest'
import { cardsFromItems, cardsToItems, emptyCuts, itemsFromCards, newCard, type SkuCard } from './cutSet'
import { cutSetItemsFromNode } from '../api/batch'
import { textsNeedingTranslation } from './translate'

const card = (id: string, sku: string, ready: Partial<Record<'front' | 'right' | 'back', string>>, extra: Partial<SkuCard['cuts']> = {}): SkuCard => {
  const cuts = emptyCuts()
  for (const [role, path] of Object.entries(ready)) cuts[role as 'front'] = { role: role as 'front', path, status: 'ready', width: 750, height: 1000, name: `${role}.jpg` }
  return { id, sku, cuts: { ...cuts, ...extra } }
}

describe('Cut Set のカード ⇄ 保存形 ⇄ ジョブの入力', () => {
  it('正面と SKU 名があるカードだけが投入の対象（正面を元画像に・cuts に役割ごと）', () => {
    const cards = [card('a', 'SKU-1', { front: 't/f.jpg', right: 't/r.jpg' }), card('b', 'SKU-2', { right: 't/r2.jpg' }), card('c', '  ', { front: 't/f3.jpg' })]
    const items = cardsToItems(cards)
    expect(items).toEqual([{ index: 1, originalName: 'front.jpg', sku: 'SKU-1', interactivePath: 't/f.jpg', width: 750, height: 1000, cuts: [{ role: 'front', path: 't/f.jpg', width: 750, height: 1000, name: 'front.jpg' }, { role: 'right', path: 't/r.jpg', width: 750, height: 1000, name: 'right.jpg' }] }])
  })
  it('保存形は ready なカットだけ・往復で同じ。アップロード中や失敗は保存しない', () => {
    const uploading = card('a', 'SKU-1', { front: 't/f.jpg' }, { back: { role: 'back', status: 'uploading', file: undefined } })
    const items = itemsFromCards([uploading, newCard(2)])
    expect(items[0]).toEqual({ id: 'a', index: 1, sku: 'SKU-1', cuts: { front: { path: 't/f.jpg', width: 750, height: 1000, name: 'front.jpg' } } })
    expect(items[1].cuts).toEqual({})
    const back = cardsFromItems(items)
    expect(back[0].cuts.front).toMatchObject({ status: 'ready', path: 't/f.jpg' })
    expect(back[0].cuts.back.status).toBe('empty')
    expect(itemsFromCards(back)).toEqual(items)
    expect(cardsFromItems(undefined)).toEqual([])
  })
  it('ノードの保存形からジョブの入力へ（Batch Input の batchItemsFromNode と同じ役割）', () => {
    const data = { items: [{ id: 'a', index: 1, sku: 'SKU-1', cuts: { front: { path: 't/f.jpg', width: 1, height: 2, name: 'f.jpg' }, left: { path: 't/l.jpg' } } }, { id: 'b', index: 2, sku: 'SKU-2', cuts: { left: { path: 't/l2.jpg' } } }] }
    expect(cutSetItemsFromNode(data)).toEqual([{ index: 1, originalName: 'f.jpg', sku: 'SKU-1', interactivePath: 't/f.jpg', width: 1, height: 2, cuts: [{ role: 'front', path: 't/f.jpg', width: 1, height: 2, name: 'f.jpg' }, { role: 'left', path: 't/l.jpg', width: undefined, height: undefined, name: undefined }] }])
    expect(cutSetItemsFromNode(undefined)).toEqual([])
  })
})

describe('textsNeedingTranslation', () => {
  it('日本語で対訳の無いものだけ（英語・組み込み文・空・重複は除く）', () => {
    expect(textsNeedingTranslation(['ゆっくり呼吸する', 'The model stands still.', '', null, 'ゆっくり呼吸する', '足は動かさず、腕はリラックス。'])).toEqual(['ゆっくり呼吸する'])
  })
})
