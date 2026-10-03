// 画像生成モデルの入力の組み立て（対話実行の ImageGenerationNode と、一括実行の計画（api/batch）で同じものを使う）。
// ブラウザ固有の機能に依存しない純関数。

export const GPT_IMAGE_2_MODELS = new Set(['openai/gpt-image-2'])
export const RECRAFT_MODELS = new Set(['fal-ai/recraft/v4/text-to-image', 'fal-ai/recraft/v4/pro/text-to-image'])

export const NB_RESOLUTIONS: Record<string, string[]> = {
  'fal-ai/nano-banana-2':   ['0.5K', '1K', '2K', '4K'],
  'fal-ai/nano-banana-pro': ['1K', '2K', '4K'],
}
export const NB_ASPECT_RATIOS: Record<string, string[]> = {
  'fal-ai/nano-banana-2':   ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'],
  'fal-ai/nano-banana-pro': ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
}
export const NB_ASPECT_RATIOS_DEFAULT = NB_ASPECT_RATIOS['fal-ai/nano-banana-2']

export interface TextToImageParams {
  aspectRatio?: unknown
  resolution?: unknown
  seed?: unknown
  gptImageSize?: unknown
  recraftImageSize?: unknown
}

/** テキストから画像（参照画像なし）の fal 入力。モデルごとの API の違いをここに閉じ込める */
export function buildTextToImageInput(model: string, prompt: string, p: TextToImageParams): Record<string, unknown> {
  const seedStr = typeof p.seed === 'string' ? p.seed.trim() : typeof p.seed === 'number' ? String(p.seed) : ''
  const seed = seedStr && Number.isFinite(Number(seedStr)) ? Number(seedStr) : null
  if (GPT_IMAGE_2_MODELS.has(model)) {
    const raw = typeof p.gptImageSize === 'string' ? p.gptImageSize : ''
    return { prompt, image_size: !raw || raw === 'auto' ? 'square_hd' : raw }
  }
  if (RECRAFT_MODELS.has(model)) {
    const input: Record<string, unknown> = { prompt, image_size: typeof p.recraftImageSize === 'string' && p.recraftImageSize ? p.recraftImageSize : 'square' }
    if (seed !== null) input.seed = seed
    return input
  }
  // Nano Banana 系（既定）: aspect_ratio + resolution。対応外の値は安全な値へ
  const aspectRatio = typeof p.aspectRatio === 'string' && p.aspectRatio ? p.aspectRatio : '1:1'
  const resolution = typeof p.resolution === 'string' && p.resolution ? p.resolution : '1K'
  const resolutions = NB_RESOLUTIONS[model]
  const aspects = NB_ASPECT_RATIOS[model]
  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspects && aspectRatio !== 'auto' && !aspects.includes(aspectRatio) ? '1:1' : aspectRatio,
    resolution: resolutions && !resolutions.includes(resolution) ? (resolutions[0] ?? '1K') : resolution,
  }
  if (seed !== null) input.seed = seed
  return input
}

export const EDIT_CAPABLE_MODELS = new Set(['fal-ai/nano-banana-2', 'fal-ai/nano-banana-pro', 'openai/gpt-image-2'])

/** 編集（画像入力あり）に使うモデル。ノードの editModel を優先し、無ければ model が編集対応ならそれ、どちらでもなければ Nano Banana 2 */
export function editModelOf(p: { editModel?: unknown; model?: unknown }): string {
  if (typeof p.editModel === 'string' && EDIT_CAPABLE_MODELS.has(p.editModel)) return p.editModel
  if (typeof p.model === 'string' && EDIT_CAPABLE_MODELS.has(p.model)) return p.model
  return 'fal-ai/nano-banana-2'
}

/** 画像を入力にした編集の fal エンドポイントと入力（image_urls は呼び出し側が足す）。ImageGenerationNode の編集モードと同じ規則 */
export function buildImageEditRequest(model: string, prompt: string, p: TextToImageParams & { gptImageSize?: unknown }): { endpoint: string; input: Record<string, unknown> } {
  const seedStr = typeof p.seed === 'string' ? p.seed.trim() : typeof p.seed === 'number' ? String(p.seed) : ''
  const seed = seedStr && Number.isFinite(Number(seedStr)) ? Number(seedStr) : null
  if (GPT_IMAGE_2_MODELS.has(model)) {
    const raw = typeof p.gptImageSize === 'string' ? p.gptImageSize : ''
    return { endpoint: 'openai/gpt-image-2/edit', input: { prompt, image_size: raw || 'square_hd' } }
  }
  const aspectRatio = typeof p.aspectRatio === 'string' && p.aspectRatio ? p.aspectRatio : '1:1'
  const resolution = typeof p.resolution === 'string' && p.resolution ? p.resolution : '1K'
  const resolutions = NB_RESOLUTIONS[model]
  const aspects = NB_ASPECT_RATIOS[model]
  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspects && aspectRatio !== 'auto' && !aspects.includes(aspectRatio) ? '1:1' : aspectRatio,
    resolution: resolutions && !resolutions.includes(resolution) ? (resolutions[0] ?? '1K') : resolution,
  }
  if (seed !== null) input.seed = seed
  return { endpoint: `${model}/edit`, input }
}
