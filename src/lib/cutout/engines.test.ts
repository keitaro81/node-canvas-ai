import { describe, it, expect } from 'vitest'
import {
  buildEngineRequest, normalizeCutoutParams, pickEngineResult, effectiveBirefnetResolution, DEFAULT_CUTOUT_PARAMS, CUTOUT_ENGINES,
} from './engines'

describe('normalizeCutoutParams', () => {
  it('未保存/不正値は既定値で補い、範囲内に丸める', () => {
    expect(normalizeCutoutParams(undefined)).toEqual(DEFAULT_CUTOUT_PARAMS)
    const p = normalizeCutoutParams({ engine: 'nope', alphaThreshold: 999, featherPx: -3, birefnetModel: 'x', previewBg: 'blue' })
    expect(p.engine).toBe('birefnet') // 既定エンジン（テストセット比較で決定）
    expect(normalizeCutoutParams({ engine: 'bria' }).engine).toBe('bria')
    expect(p.alphaThreshold).toBe(255)
    expect(p.featherPx).toBe(0)
    expect(p.birefnetModel).toBe(DEFAULT_CUTOUT_PARAMS.birefnetModel)
    expect(p.previewBg).toBe('checker')
  })
})

describe('buildEngineRequest（原則2: マスクだけを使う）', () => {
  it('BiRefNet は前景リファイン無効・マスク出力あり・エンドポイントは allowlist と一致', () => {
    const r = buildEngineRequest({ ...DEFAULT_CUTOUT_PARAMS, engine: 'birefnet' }, 'https://x/img.png')
    expect(r.endpoint).toBe('fal-ai/birefnet/v2')
    expect(r.input).toMatchObject({ image_url: 'https://x/img.png', refine_foreground: false, output_mask: true, mask_only: true, output_format: 'png' })
  })
  it('Bria は image_url のみ', () => {
    const r = buildEngineRequest({ ...DEFAULT_CUTOUT_PARAMS, engine: 'bria' }, 'https://x/img.png')
    expect(r.endpoint).toBe(CUTOUT_ENGINES.bria.endpoint)
    expect(r.input).toEqual({ image_url: 'https://x/img.png' })
  })
  it('2304 は Dynamic 以外では 2048 に落とす', () => {
    expect(effectiveBirefnetResolution('General Use (Light)', '2304x2304')).toBe('2048x2048')
    expect(effectiveBirefnetResolution('General Use (Dynamic)', '2304x2304')).toBe('2304x2304')
    const r = buildEngineRequest({ ...DEFAULT_CUTOUT_PARAMS, engine: 'birefnet', birefnetResolution: '2304x2304' }, 'u')
    expect(r.input.operating_resolution).toBe('2048x2048')
  })
})

describe('pickEngineResult', () => {
  it('BiRefNet は mask_image を優先し、無ければ image（mask_only 時）', () => {
    expect(pickEngineResult('birefnet', { image: { url: 'i' }, mask_image: { url: 'm', width: 2, height: 3 } })).toEqual({ url: 'm', kind: 'mask', width: 2, height: 3 })
    expect(pickEngineResult('birefnet', { image: { url: 'i' } }).url).toBe('i')
    expect(() => pickEngineResult('birefnet', {})).toThrow()
  })
  it('Bria は image を透過 PNG として扱う', () => {
    expect(pickEngineResult('bria', { image: { url: 'i', width: 1, height: 1 } })).toEqual({ url: 'i', kind: 'rgba', width: 1, height: 1 })
    expect(() => pickEngineResult('bria', { foo: 1 })).toThrow()
  })
})
