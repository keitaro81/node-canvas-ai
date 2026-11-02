import { describe, it, expect } from 'vitest'
import { applyNamePattern, appendNamePart, buildNamePattern, cutoutNameFor, dateToken, folderFor, isReservedVariantName, normalizeExportParams, parseNamePattern, planExportEntries, presetIdOf, qualitySteps, removeNamePart, sanitizeFileName, unknownTokens, zipFileName, DEFAULT_EXPORT_PARAMS } from './naming'

const now = new Date('2026-09-23T15:30:00Z') // JST 2026-09-24 00:30
const item = { sku: 'AB-123', original: 'AB-123_front', index: 7 }

describe('applyNamePattern', () => {
  it('全トークンを展開する（{index:02} はゼロ埋め、{date} は JST）', () => {
    expect(applyNamePattern('{sku}_{variant}_{index:02}', { ...item, variant: 'ec_white', now })).toBe('AB-123_ec_white_07')
    expect(applyNamePattern('{original}-{index}-{date}', { ...item, variant: 'x', now })).toBe('AB-123_front-7-20260924')
    expect(applyNamePattern('{index:04}', { ...item, variant: 'x', now })).toBe('0007')
  })
  it('未知のトークンは残し、使えない文字は _ にする', () => {
    expect(applyNamePattern('{sku}_{foo}', { ...item, variant: 'x', now })).toBe('AB-123_{foo}')
    expect(sanitizeFileName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
  })
})

describe('planExportEntries', () => {
  const inputs = [
    { variant: 'ec_white', transparent: false },
    { variant: 'sns', transparent: false },
    { variant: 'story', transparent: true },
  ]
  it('既定（JPEG・ZIP・バリアント別）: 3 ファイル、透過は PNG に切替＋警告', () => {
    const { entries, warnings } = planExportEntries(inputs, DEFAULT_EXPORT_PARAMS, item, now)
    expect(entries.map((e) => `${e.folder}${e.base}.${e.ext}`)).toEqual(['ec_white/AB-123_ec_white_07.jpg', 'sns/AB-123_sns_07.jpg', 'story/AB-123_story_07.png'])
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('PNG')
  })
  it('重複は連番を付けて警告する', () => {
    const dup = [{ variant: 'v', transparent: false }, { variant: 'v', transparent: false }]
    const { entries, warnings } = planExportEntries(dup, { ...DEFAULT_EXPORT_PARAMS, zipFolders: 'none' }, item, now)
    expect(entries.map((e) => e.base)).toEqual(['AB-123_v_07', 'AB-123_v_07_2'])
    expect(warnings.some((w) => w.includes('連番'))).toBe(true)
  })
  it('フォルダ分け: SKU 別 / なし / ZIP なしはフォルダ無し', () => {
    expect(folderFor('sku', 'v', 'AB-123')).toBe('AB-123/')
    expect(folderFor('none', 'v', 'AB-123')).toBe('')
    const { entries } = planExportEntries(inputs.slice(0, 1), { ...DEFAULT_EXPORT_PARAMS, zip: false }, item, now)
    expect(entries[0].folder).toBe('')
  })
  it('PNG/WebP 指定のとき透過でも切替えない', () => {
    const { entries, warnings } = planExportEntries(inputs.slice(2), { ...DEFAULT_EXPORT_PARAMS, format: 'webp' }, item, now)
    expect(entries[0].ext).toBe('webp'); expect(warnings).toEqual([])
  })
})

describe('その他', () => {
  it('qualitySteps: 90 → 90,85,80,75,70。下限 70 未満は 70', () => {
    expect(qualitySteps(90)).toEqual([90, 85, 80, 75, 70])
    expect(qualitySteps(92)).toEqual([92, 87, 82, 77, 72, 70])
    expect(qualitySteps(60)).toEqual([70])
  })
  it('normalize と dateToken と zipFileName', () => {
    expect(normalizeExportParams(undefined)).toEqual(DEFAULT_EXPORT_PARAMS)
    const p = normalizeExportParams({ format: 'gif', jpegQuality: 10, maxFileKb: -1, zipFolders: 'x', namePattern: ' ' })
    expect(p.format).toBe('jpeg'); expect(p.jpegQuality).toBe(70); expect(p.maxFileKb).toBeNull(); expect(p.zipFolders).toBe('variant'); expect(p.namePattern).toBe(DEFAULT_EXPORT_PARAMS.namePattern)
    expect(dateToken(now)).toBe('20260924')
    expect(zipFileName(item, now)).toBe('AB-123_20260924.zip')
    expect(zipFileName(item, now, 'wf-name')).toBe('wf-name_20260924.zip')   // アイテム情報が無いときはワークフロー名
    expect(zipFileName(item, now, '  ')).toBe('AB-123_20260924.zip')
  })
  it('unknownTokens: 置き換えできない {…} を列挙（固定の文字を {} で囲んだ指摘・2026-11-01）', () => {
    expect(unknownTokens('{商品動画}_{右反転}_{index:02}')).toEqual(['{商品動画}', '{右反転}'])
    expect(unknownTokens('{sku}_{original}_{variant}_{index}_{index:02}_{date}')).toEqual([])
    expect(unknownTokens('商品動画_{sku}_{index:3}')).toEqual(['{index:3}'])
  })
})

describe('切り抜きの透過 PNG（includeCutout / forcePng）', () => {
  it('forcePng の入力は JPEG 指定でも警告なしで PNG になる', () => {
    const { entries, warnings } = planExportEntries([{ variant: 'cutout', transparent: true, forcePng: true }, { variant: 'ec_white', transparent: false }], DEFAULT_EXPORT_PARAMS, item, now)
    expect(entries.map((e) => `${e.folder}${e.base}.${e.ext}`)).toEqual(['cutout/AB-123_cutout_07.png', 'ec_white/AB-123_ec_white_07.jpg'])
    expect(warnings).toEqual([])
  })
  it('includeCutout の既定は true。boolean 以外は既定に戻す', () => {
    expect(normalizeExportParams({}).includeCutout).toBe(true)
    expect(normalizeExportParams({ includeCutout: false }).includeCutout).toBe(false)
    expect(normalizeExportParams({ includeCutout: 'yes' }).includeCutout).toBe(true)
  })
})

describe('ZIP 内のフォルダ分け: 対象が 1 つだけならフォルダを作らない（2026-11-01 メモ 34）', () => {
  const item = { sku: 'AB-1', original: 'a.jpg', index: 1 }
  const now = new Date('2026-11-01T00:00:00Z')
  it('バリアント別: 動画 1 本（バリアント 1 種類）はルート直下、2 種類ならフォルダ', () => {
    const one = planExportEntries([{ variant: 'Reference Video', transparent: false, video: true }], { ...DEFAULT_EXPORT_PARAMS, zipFolders: 'variant' }, item, now)
    expect(one.entries.map((e) => `${e.folder}${e.base}.${e.ext}`)).toEqual(['AB-1_Reference Video_01.mp4'])
    const two = planExportEntries([{ variant: 'ec_white', transparent: false }, { variant: 'ec_gray', transparent: false }], { ...DEFAULT_EXPORT_PARAMS, zipFolders: 'variant' }, item, now)
    expect(two.entries.map((e) => e.folder)).toEqual(['ec_white/', 'ec_gray/'])
  })
  it('SKU 別: SKU が 1 件だけ（Export ノード）はルート直下、件数が分からない / 複数ならフォルダ', () => {
    const p = { ...DEFAULT_EXPORT_PARAMS, zipFolders: 'sku' as const }
    expect(planExportEntries([{ variant: 'v', transparent: false }], p, item, now, { skus: 1 }).entries[0].folder).toBe('')
    expect(planExportEntries([{ variant: 'v', transparent: false }], p, item, now, { skus: 3 }).entries[0].folder).toBe('AB-1/')
    expect(planExportEntries([{ variant: 'v', transparent: false }], p, item, now).entries[0].folder).toBe('AB-1/')
  })
})

describe('一括の「商品名」は写真の名前そのまま（2026-11-02 メモ 65）', () => {
  const now = new Date('2026-11-02T12:40:00Z')
  const photo = { sku: '61141146370', original: '61141146370_D_17', index: 1, name: '61141146370_D_17' }
  it('{sku}（商品名）は name を使い、商品別のフォルダは SKU でまとめる', () => {
    expect(applyNamePattern('{sku}_{variant}_{index:02}', { ...photo, variant: 'EC', now })).toBe('61141146370_D_17_EC_01')
    const p = { ...DEFAULT_EXPORT_PARAMS, format: 'png' as const, zipFolders: 'sku' as const }
    expect(planExportEntries([{ variant: 'EC', transparent: false }], p, photo, now, { skus: 2 }).entries[0]).toMatchObject({ folder: '61141146370/', base: '61141146370_D_17_EC_01' })
  })
  it('name が無い（一括でない Export・前の形の写真の情報）は今までどおり sku', () => {
    expect(applyNamePattern('{sku}_{variant}', { sku: '2026aw', original: 'image', index: 1, variant: 'EC', now })).toBe('2026aw_EC')
    expect(zipFileName({ sku: '2026aw', original: 'image', index: 1 }, now)).toBe('2026aw_20261102.zip')
    expect(zipFileName(photo, now)).toBe('61141146370_D_17_20261102.zip')
  })
})

describe('名前の付け方（型＋部品・2026-11-02 メモ 43）', () => {
  it('記号の文字列と部品を行き来できる（知らない {…} は固定の文字のまま）', () => {
    const parts = parseNamePattern('商品動画_{sku}_{index:02}{foo}')
    expect(parts).toEqual([{ kind: 'text', text: '商品動画_' }, { kind: 'sku' }, { kind: 'text', text: '_' }, { kind: 'index', pad: 2 }, { kind: 'text', text: '{foo}' }])
    expect(buildNamePattern(parts)).toBe('商品動画_{sku}_{index:02}{foo}')
    expect(buildNamePattern(parseNamePattern('{original}_{variant}_{index}_{date}'))).toBe('{original}_{variant}_{index}_{date}')
  })
  it('型の一覧と同じなら型の id、違えば「自分で組む」', () => {
    expect(presetIdOf('{sku}_{variant}_{index:02}')).toBe('sku_variant_index')
    expect(presetIdOf(' {original} ')).toBe('original')
    expect(presetIdOf('{sku}_{date}')).toBe('custom')
  })
  it('足すときは区切りの _ を挟み、外すときは区切りも一緒に外す', () => {
    const base = parseNamePattern('{sku}_{variant}_{index:02}')
    expect(buildNamePattern(appendNamePart(base, { kind: 'date' }))).toBe('{sku}_{variant}_{index:02}_{date}')
    expect(buildNamePattern(appendNamePart(parseNamePattern('{sku}_'), { kind: 'date' }))).toBe('{sku}_{date}')
    expect(buildNamePattern(appendNamePart(parseNamePattern('{sku}'), { kind: 'text', text: '文字' }))).toBe('{sku}_文字')
    expect(buildNamePattern(appendNamePart([], { kind: 'sku' }))).toBe('{sku}')
    expect(buildNamePattern(removeNamePart(base, 2))).toBe('{sku}_{index:02}')   // バリアント（と前の _）
    expect(buildNamePattern(removeNamePart(base, 0))).toBe('{variant}_{index:02}')   // 先頭は後ろの _ と一緒に
    expect(buildNamePattern(removeNamePart(parseNamePattern('商品動画{sku}'), 1))).toBe('商品動画')   // 区切りでない文字は残す
  })
  it('cutout は切り抜き PNG の予約名（バリアント名にあれば切り抜き側を cutout_png に）', () => {
    expect(isReservedVariantName(' Cutout ')).toBe(true)
    expect(isReservedVariantName('cutout2')).toBe(false)
    expect(cutoutNameFor(['ec_white', 'insta'])).toBe('cutout')
    expect(cutoutNameFor(['ec_white', 'cutout'])).toBe('cutout_png')
  })
})
