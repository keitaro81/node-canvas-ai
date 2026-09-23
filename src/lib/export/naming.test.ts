import { describe, it, expect } from 'vitest'
import { applyNamePattern, dateToken, folderFor, normalizeExportParams, planExportEntries, qualitySteps, sanitizeFileName, zipFileName, DEFAULT_EXPORT_PARAMS } from './naming'

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
  })
})
