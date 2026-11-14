import { describe, it, expect } from 'vitest'
import {
  EDIT_MODEL_OPTIONS, GPT_IMAGE_HD_MODEL, GPT_IMAGE_MODEL, INPAINT_MODEL_OPTIONS, NB_MODEL, NB_PRO_MODEL, NB_RESOLUTIONS, T2I_MODEL_OPTIONS,
  buildImageEditRequest, buildTextToImageInput, editModelOf, imageEditEndpointOf, inpaintModelOf, normalizeImageModel, safeNbResolution, textToImageEndpointOf,
} from './imageGenModels'

describe('モデルの置き換え（2026-11-14: Nano Banana 2 → 2.1・GPT-Image-2 → GPT Image 2.6）', () => {
  it('今のモデル id は fal のエンドポイントの名前と合っている', () => {
    expect(NB_MODEL).toBe('google/nano-banana-2.1')
    expect(GPT_IMAGE_MODEL).toBe('openai/gpt-image-2.6/flare')
    expect(GPT_IMAGE_HD_MODEL).toBe('openai/gpt-image-2.6/sunburst')
  })

  it('保存済みの旧 id は、読むたびに今の id に寄せる（保存し直さなくても新しいモデルで動く）', () => {
    expect(normalizeImageModel('fal-ai/nano-banana-2')).toBe(NB_MODEL)
    expect(normalizeImageModel('openai/gpt-image-2')).toBe(GPT_IMAGE_MODEL)
    // 置き換えていないものはそのまま
    expect(normalizeImageModel(NB_MODEL)).toBe(NB_MODEL)
    expect(normalizeImageModel(NB_PRO_MODEL)).toBe(NB_PRO_MODEL)
    expect(normalizeImageModel('fal-ai/recraft/v4/text-to-image')).toBe('fal-ai/recraft/v4/text-to-image')
    // 値が無いときは undefined（既定は呼び出し側が決める）
    expect(normalizeImageModel(undefined)).toBeUndefined()
    expect(normalizeImageModel('')).toBeUndefined()
    expect(normalizeImageModel(42)).toBeUndefined()
  })

  it('エンドポイント: GPT Image 2.6 のテキストから画像は /text-to-image、編集はどれも /edit', () => {
    expect(textToImageEndpointOf(NB_MODEL)).toBe('google/nano-banana-2.1')
    expect(textToImageEndpointOf(NB_PRO_MODEL)).toBe('fal-ai/nano-banana-pro')
    expect(textToImageEndpointOf('fal-ai/recraft/v4/text-to-image')).toBe('fal-ai/recraft/v4/text-to-image')
    expect(textToImageEndpointOf(GPT_IMAGE_MODEL)).toBe('openai/gpt-image-2.6/flare/text-to-image')
    expect(textToImageEndpointOf(GPT_IMAGE_HD_MODEL)).toBe('openai/gpt-image-2.6/sunburst/text-to-image')
    expect(imageEditEndpointOf(NB_MODEL)).toBe('google/nano-banana-2.1/edit')
    expect(imageEditEndpointOf(GPT_IMAGE_HD_MODEL)).toBe('openai/gpt-image-2.6/sunburst/edit')
    // 旧 id を渡しても、今のエンドポイントになる
    expect(textToImageEndpointOf('fal-ai/nano-banana-2')).toBe('google/nano-banana-2.1')
    expect(textToImageEndpointOf('openai/gpt-image-2')).toBe('openai/gpt-image-2.6/flare/text-to-image')
    expect(imageEditEndpointOf('fal-ai/nano-banana-2')).toBe('google/nano-banana-2.1/edit')
    expect(imageEditEndpointOf('openai/gpt-image-2')).toBe('openai/gpt-image-2.6/flare/edit')
  })

  it('選択肢に旧モデルは出ない。部分修正（マスクつき）は GPT Image の 2 種だけ', () => {
    const values = (xs: Array<{ value: string }>) => xs.map((x) => x.value)
    for (const list of [T2I_MODEL_OPTIONS, EDIT_MODEL_OPTIONS, INPAINT_MODEL_OPTIONS]) {
      expect(values(list)).not.toContain('fal-ai/nano-banana-2')
      expect(values(list)).not.toContain('openai/gpt-image-2')
      expect(list.every((o) => o.label && o.label !== o.value)).toBe(true)   // 表示名がある
    }
    expect(values(T2I_MODEL_OPTIONS)[0]).toBe(NB_MODEL)   // 先頭 = 既定
    expect(values(INPAINT_MODEL_OPTIONS)).toEqual([GPT_IMAGE_MODEL, GPT_IMAGE_HD_MODEL])
  })

  it('Nano Banana 2.1 には 0.5K が無い: 前のモデルで 0.5K を選んでいたノードは 1K で動く', () => {
    expect(NB_RESOLUTIONS[NB_MODEL]).toEqual(['1K', '2K', '4K'])
    expect(safeNbResolution(NB_MODEL, '0.5K')).toBe('1K')
    expect(safeNbResolution(NB_MODEL, '2K')).toBe('2K')
    expect(buildTextToImageInput('fal-ai/nano-banana-2', 'p', { aspectRatio: '4:1', resolution: '0.5K' })).toEqual({ prompt: 'p', aspect_ratio: '4:1', resolution: '1K' })
    expect(buildImageEditRequest('fal-ai/nano-banana-2', 'p', { aspectRatio: 'auto', resolution: '0.5K' })).toEqual({ endpoint: 'google/nano-banana-2.1/edit', input: { prompt: 'p', aspect_ratio: 'auto', resolution: '1K' } })
  })
})

describe('buildTextToImageInput（モデルごとの fal 入力）', () => {
  it('Nano Banana 系は aspect_ratio と resolution。対応外の値は安全な値へ', () => {
    expect(buildTextToImageInput(NB_MODEL, 'p', { aspectRatio: '9:16', resolution: '1K' })).toEqual({ prompt: 'p', aspect_ratio: '9:16', resolution: '1K' })
    expect(buildTextToImageInput(NB_PRO_MODEL, 'p', { aspectRatio: '4:1', resolution: '0.5K' })).toEqual({ prompt: 'p', aspect_ratio: '1:1', resolution: '1K' })
    expect(buildTextToImageInput(NB_MODEL, 'p', { seed: '42' })).toEqual({ prompt: 'p', aspect_ratio: '1:1', resolution: '1K', seed: 42 })
    expect(buildTextToImageInput(NB_MODEL, 'p', { seed: 'abc' })).toEqual({ prompt: 'p', aspect_ratio: '1:1', resolution: '1K' })   // 数字でない seed は送らない
  })
  it('GPT Image は image_size（auto は square_hd）。標準も高精細も同じ入力', () => {
    expect(buildTextToImageInput(GPT_IMAGE_MODEL, 'p', { gptImageSize: 'portrait_16_9' })).toEqual({ prompt: 'p', image_size: 'portrait_16_9' })
    expect(buildTextToImageInput(GPT_IMAGE_HD_MODEL, 'p', { gptImageSize: 'auto' })).toEqual({ prompt: 'p', image_size: 'square_hd' })
    expect(buildTextToImageInput('openai/gpt-image-2', 'p', { gptImageSize: 'square' })).toEqual({ prompt: 'p', image_size: 'square' })   // 旧 id でも同じ
  })
  it('Recraft は image_size プリセット', () => {
    expect(buildTextToImageInput('fal-ai/recraft/v4/text-to-image', 'p', { recraftImageSize: 'portrait_4_3', seed: '' })).toEqual({ prompt: 'p', image_size: 'portrait_4_3' })
  })
})

describe('buildImageEditRequest / editModelOf（画像入力つきの編集）', () => {
  it('Nano Banana 系は <model>/edit に aspect_ratio + resolution（auto 可）', () => {
    expect(buildImageEditRequest(NB_MODEL, 'p', { aspectRatio: 'auto', resolution: '1K' })).toEqual({ endpoint: 'google/nano-banana-2.1/edit', input: { prompt: 'p', aspect_ratio: 'auto', resolution: '1K' } })
    expect(buildImageEditRequest(NB_PRO_MODEL, 'p', { aspectRatio: '4:1', resolution: '0.5K' })).toEqual({ endpoint: 'fal-ai/nano-banana-pro/edit', input: { prompt: 'p', aspect_ratio: '1:1', resolution: '1K' } })
  })
  it('GPT Image は /edit に image_size', () => {
    expect(buildImageEditRequest(GPT_IMAGE_MODEL, 'p', { gptImageSize: 'auto' })).toEqual({ endpoint: 'openai/gpt-image-2.6/flare/edit', input: { prompt: 'p', image_size: 'auto' } })
    expect(buildImageEditRequest(GPT_IMAGE_HD_MODEL, 'p', {})).toEqual({ endpoint: 'openai/gpt-image-2.6/sunburst/edit', input: { prompt: 'p', image_size: 'square_hd' } })
    expect(buildImageEditRequest('openai/gpt-image-2', 'p', { gptImageSize: 'auto' }).endpoint).toBe('openai/gpt-image-2.6/flare/edit')   // 旧 id
  })
  it('編集モデルの決め方: editModel → model（編集に対応していれば）→ 既定の Nano Banana。旧 id は今の id として返す', () => {
    expect(editModelOf({ editModel: NB_PRO_MODEL, model: GPT_IMAGE_MODEL })).toBe(NB_PRO_MODEL)
    expect(editModelOf({ model: GPT_IMAGE_HD_MODEL })).toBe(GPT_IMAGE_HD_MODEL)
    expect(editModelOf({ model: 'fal-ai/recraft/v4/text-to-image' })).toBe(NB_MODEL)
    expect(editModelOf({})).toBe(NB_MODEL)
    expect(editModelOf({ editModel: 'fal-ai/nano-banana-2' })).toBe(NB_MODEL)
    expect(editModelOf({ model: 'openai/gpt-image-2' })).toBe(GPT_IMAGE_MODEL)
  })
  it('部分修正（マスクつき）のモデル: GPT Image を選んでいればそれ（標準 / 高精細）、ほかは標準の GPT Image', () => {
    expect(inpaintModelOf(GPT_IMAGE_HD_MODEL)).toBe(GPT_IMAGE_HD_MODEL)
    expect(inpaintModelOf(GPT_IMAGE_MODEL)).toBe(GPT_IMAGE_MODEL)
    expect(inpaintModelOf(NB_MODEL)).toBe(GPT_IMAGE_MODEL)
    expect(inpaintModelOf('openai/gpt-image-2')).toBe(GPT_IMAGE_MODEL)
    expect(inpaintModelOf(undefined)).toBe(GPT_IMAGE_MODEL)
  })
})
