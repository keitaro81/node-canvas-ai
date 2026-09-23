import { describe, it, expect } from 'vitest'
import { applySkuPattern, extractSku, itemInfoOf, naturalCompare, normalizeBatchInputParams, safeFileName, sortAndIndexItems, stripExtension, DEFAULT_SKU_PATTERN } from './items'

describe('extractSku', () => {
  it('既定パターン: 先頭から最初のアンダースコアまで', () => {
    expect(extractSku('AB-123_front.jpg', DEFAULT_SKU_PATTERN)).toBe('AB-123')
    expect(extractSku('sku001_01.webp', DEFAULT_SKU_PATTERN)).toBe('sku001')
  })
  it('一致しなければ拡張子を除いたファイル名', () => {
    expect(extractSku('IMG 0001.jpg', DEFAULT_SKU_PATTERN)).toBe('IMG 0001')
    expect(extractSku('noext', DEFAULT_SKU_PATTERN)).toBe('noext')
  })
  it('グループ無しのパターンは一致全体、不正な正規表現はファイル名', () => {
    expect(extractSku('01_001-750 (4).jpg', '^\\d+')).toBe('01')
    expect(extractSku('01_001-750 (4).jpg', '([')).toBe('01_001-750 (4)')
  })
})

describe('並び順と index', () => {
  it('自然順（img2 < img10）で並べ、index を 1 から振る', () => {
    const items = [
      { originalName: 'img10.jpg', index: 0 }, { originalName: 'img2.jpg', index: 0 }, { originalName: 'Img1.jpg', index: 0 },
    ]
    const sorted = sortAndIndexItems(items)
    expect(sorted.map((i) => i.originalName)).toEqual(['Img1.jpg', 'img2.jpg', 'img10.jpg'])
    expect(sorted.map((i) => i.index)).toEqual([1, 2, 3])
    expect(naturalCompare('a2', 'a10')).toBeLessThan(0)
  })
  it('applySkuPattern は変わらないアイテムを同一参照のまま返す', () => {
    const items = [{ originalName: 'AB_1.jpg', sku: 'AB' }, { originalName: 'CD_2.jpg', sku: 'x' }]
    const out = applySkuPattern(items, DEFAULT_SKU_PATTERN)
    expect(out[0]).toBe(items[0])
    expect(out[1].sku).toBe('CD')
  })
})

describe('その他', () => {
  it('stripExtension / itemInfoOf / safeFileName / normalize', () => {
    expect(stripExtension('a/b/c.d.png')).toBe('c.d')
    expect(itemInfoOf({ sku: 'S', originalName: 'S_1.jpg', index: 3 })).toEqual({ sku: 'S', original: 'S_1', index: 3 })
    expect(safeFileName('01_001-750 (4).jpg')).toBe('01_001-750__4_.jpg')
    expect(safeFileName('日本語.png')).toBe('___.png')
    expect(normalizeBatchInputParams({ skuPattern: '  ' }).skuPattern).toBe(DEFAULT_SKU_PATTERN)
    expect(normalizeBatchInputParams({ skuPattern: '^x' }).skuPattern).toBe('^x')
  })
})
