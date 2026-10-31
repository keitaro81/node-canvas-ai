import { describe, it, expect } from 'vitest'
import { DEFAULT_EXPORT_PARAMS, planExportEntries } from './naming'

describe('planExportEntries（動画）', () => {
  it('動画は形式の設定に関わらず mp4。フォルダ分け・命名規則は画像と同じ', () => {
    const item = { sku: 'SKU-1', original: 'front', index: 3 }
    const now = new Date('2026-10-31T00:00:00Z')
    const { entries, warnings } = planExportEntries([{ variant: 'Video Merge', transparent: false, video: true }, { variant: 'ec_white', transparent: false }], { ...DEFAULT_EXPORT_PARAMS, format: 'png' }, item, now)
    expect(entries.map((e) => `${e.folder}${e.base}.${e.ext}`)).toEqual(['Video Merge/SKU-1_Video Merge_03.mp4', 'ec_white/SKU-1_ec_white_03.png'])
    expect(warnings).toEqual([])
    const single = planExportEntries([{ variant: 'Video Merge', transparent: false, video: true }], { ...DEFAULT_EXPORT_PARAMS, zip: false, namePattern: '{sku}' }, item, now)
    expect(`${single.entries[0].folder}${single.entries[0].base}.${single.entries[0].ext}`).toBe('SKU-1.mp4')
  })
})
