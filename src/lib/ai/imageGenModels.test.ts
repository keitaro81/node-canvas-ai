import { describe, it, expect } from 'vitest'
import { buildImageEditRequest, buildTextToImageInput, editModelOf } from './imageGenModels'

describe('buildTextToImageInput（モデルごとの fal 入力）', () => {
  it('Nano Banana 系は aspect_ratio と resolution。対応外の値は安全な値へ', () => {
    expect(buildTextToImageInput('fal-ai/nano-banana-2', 'p', { aspectRatio: '9:16', resolution: '1K' })).toEqual({ prompt: 'p', aspect_ratio: '9:16', resolution: '1K' })
    expect(buildTextToImageInput('fal-ai/nano-banana-pro', 'p', { aspectRatio: '4:1', resolution: '0.5K' })).toEqual({ prompt: 'p', aspect_ratio: '1:1', resolution: '1K' })
    expect(buildTextToImageInput('fal-ai/nano-banana-2', 'p', { seed: '42' })).toEqual({ prompt: 'p', aspect_ratio: '1:1', resolution: '1K', seed: 42 })
  })
  it('GPT-image-2 は image_size（auto は square_hd）', () => {
    expect(buildTextToImageInput('openai/gpt-image-2', 'p', { gptImageSize: 'portrait_16_9' })).toEqual({ prompt: 'p', image_size: 'portrait_16_9' })
    expect(buildTextToImageInput('openai/gpt-image-2', 'p', { gptImageSize: 'auto' })).toEqual({ prompt: 'p', image_size: 'square_hd' })
  })
  it('Recraft は image_size プリセット', () => {
    expect(buildTextToImageInput('fal-ai/recraft/v4/text-to-image', 'p', { recraftImageSize: 'portrait_4_3', seed: '' })).toEqual({ prompt: 'p', image_size: 'portrait_4_3' })
  })
})

describe('buildImageEditRequest / editModelOf（画像入力つきの編集）', () => {
  it('Nano Banana 系は <model>/edit に aspect_ratio + resolution（auto 可）', () => {
    expect(buildImageEditRequest('fal-ai/nano-banana-2', 'p', { aspectRatio: 'auto', resolution: '1K' })).toEqual({ endpoint: 'fal-ai/nano-banana-2/edit', input: { prompt: 'p', aspect_ratio: 'auto', resolution: '1K' } })
    expect(buildImageEditRequest('fal-ai/nano-banana-pro', 'p', { aspectRatio: '4:1', resolution: '0.5K' }).input).toEqual({ prompt: 'p', aspect_ratio: '1:1', resolution: '1K' })
  })
  it('GPT-Image-2 は /edit に image_size', () => {
    expect(buildImageEditRequest('openai/gpt-image-2', 'p', { gptImageSize: 'auto' })).toEqual({ endpoint: 'openai/gpt-image-2/edit', input: { prompt: 'p', image_size: 'auto' } })
  })
  it('編集モデルの決め方', () => {
    expect(editModelOf({ editModel: 'fal-ai/nano-banana-pro', model: 'openai/gpt-image-2' })).toBe('fal-ai/nano-banana-pro')
    expect(editModelOf({ model: 'openai/gpt-image-2' })).toBe('openai/gpt-image-2')
    expect(editModelOf({ model: 'fal-ai/recraft/v4/text-to-image' })).toBe('fal-ai/nano-banana-2')
  })
})
