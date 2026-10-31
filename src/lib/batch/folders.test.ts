import { describe, it, expect } from 'vitest'
import { folderColumnsOf, folderImageName, folderTitle, parseTileKey, previewPathsOf } from './folders'
import { CUTOUT_VARIANT_KEY, fullFileName, resultKeyOf, thumbKey, type ReviewResultColumn, type ReviewVariant } from '../review/model'
import { normalizeLayoutParams } from '../layout/computeLayout'

const items = [
  { id: 'i1', job_id: 'j1', sort_order: 1 }, { id: 'i2', job_id: 'j1', sort_order: 2 }, { id: 'i3', job_id: 'j1', sort_order: 3 }, { id: 'i4', job_id: 'j1', sort_order: 4 },
  { id: 'k1', job_id: 'j2', sort_order: 1 },
]
const o = (item_id: string, variant: string, output_path: string, created_at = '2026-10-31T00:00:00Z') => ({ item_id, variant, output_path, created_at })

describe('previewPathsOf', () => {
  it('先頭 3 枚の写真から、ジョブ内で同じ列（持っている写真が多い列・同数ならレイアウト優先）のサムネイルを選ぶ', () => {
    const outputs = [
      o('i1', CUTOUT_VARIANT_KEY, 'c1'), o('i1', 'layout-a', 'a1'), o('i1', resultKeyOf('gen'), 'r1'),
      o('i2', CUTOUT_VARIANT_KEY, 'c2'), o('i2', 'layout-a', 'a2'),
      o('i3', CUTOUT_VARIANT_KEY, 'c3'), o('i3', 'layout-a', 'a3'),
      o('i4', 'layout-a', 'a4'),   // 4 枚目は使わない
    ]
    expect(previewPathsOf(items, outputs)).toEqual({ j1: ['a1', 'a2', 'a3'], j2: [] })
  })
  it('揃う列が無い写真は、その写真が持つ列で補う。記録が無い写真は飛ばす', () => {
    const outputs = [o('i1', 'layout-a', 'a1'), o('i2', CUTOUT_VARIANT_KEY, 'c2'), o('i2', resultKeyOf('gen'), 'r2')]
    expect(previewPathsOf(items, outputs).j1).toEqual(['a1', 'r2'])
  })
  it('同じ写真 × 列に複数の記録があれば新しいもの', () => {
    const outputs = [o('k1', 'layout-a', 'old', '2026-10-01T00:00:00Z'), o('k1', 'layout-a', 'new', '2026-10-30T00:00:00Z')]
    expect(previewPathsOf(items, outputs).j2).toEqual(['new'])
  })
})

describe('folderColumnsOf', () => {
  const params = normalizeLayoutParams({ variantName: 'white', width: 1200, height: 1500 })
  const v: ReviewVariant = { key: 'layout-a', name: 'white', params, baseParams: params, overridden: false, added: false, backgroundNodeId: null }
  const r: ReviewResultColumn = { key: resultKeyOf('gen'), nodeId: 'gen', name: 'Retouch', stage: 1 }
  it('切り抜きノードがあれば 切り抜き + バリアント、続けて生成結果', () => {
    const cols = folderColumnsOf(true, [v], [r])
    expect(cols.map((c) => [c.key, c.kind, c.size])).toEqual([[CUTOUT_VARIANT_KEY, 'cutout', '元のサイズ'], ['layout-a', 'variant', '1200×1500'], [resultKeyOf('gen'), 'result', '生成結果']])
    expect(cols[1].width).toBe(1200)
  })
  it('切り抜きノードが無いジョブは生成結果の列だけ', () => {
    expect(folderColumnsOf(false, [v], [r]).map((c) => c.key)).toEqual([resultKeyOf('gen')])
  })
})

describe('tile keys and names', () => {
  it('thumbKey と同じ形を読み戻す（列キーに : を含んでも）', () => {
    expect(parseTileKey(thumbKey('i1', resultKeyOf('node:1')))).toEqual({ itemId: 'i1', key: resultKeyOf('node:1') })
  })
  it('folderImageName はファイル名に使えない文字を _ にする', () => {
    expect(folderImageName('ABC/001', 'white: 1200')).toBe('ABC_001_white_ 1200')
    expect(folderImageName('', 'cutout')).toBe('image_cutout')
  })
  it('fullFileName は識別値の先頭 12 桁と形式', () => {
    expect(fullFileName(CUTOUT_VARIANT_KEY, 'abcdef0123456789', 'png')).toBe('full-cutout-abcdef012345.png')
    expect(fullFileName('productLayoutNode-1', 'abcdef0123456789', 'jpeg')).toBe('full-productLayoutNode-1-abcdef012345.jpg')
  })
})

describe('folderTitle', () => {
  it('自動命名（日時 枚数）は日時だけ、名前を付けた処理はその名前', () => {
    expect(folderTitle({ jobName: '2026-10-04 19:27 2枚', createdAt: '2026-10-04T10:27:00Z' })).toMatch(/^2026-10-04 19:27/)
    expect(folderTitle({ jobName: ' 秋物 第 1 便 ', createdAt: '2026-10-04T10:27:00Z' })).toBe('秋物 第 1 便')
  })
})
