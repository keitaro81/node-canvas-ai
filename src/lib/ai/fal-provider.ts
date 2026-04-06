import { fal } from './fal-client'
import type { AIProvider, GenerationRequest, GenerationResult } from './types'

// flux-schnell / flux-dev は image_size プリセット名を使う
const RATIO_TO_IMAGE_SIZE: Record<string, string> = {
  '1:1':  'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:3':  'landscape_4_3',
  '3:4':  'portrait_4_3',
}

// flux-1.1-pro / flux-2 は aspect_ratio パラメータでそのまま受け取る
const MODELS_WITH_ASPECT_RATIO = [
  'black-forest-labs/flux-1.1-pro',
  'fal-ai/flux-2',
]

function buildSizeParam(model: string, ratio: string): Record<string, unknown> {
  if (MODELS_WITH_ASPECT_RATIO.includes(model)) {
    return { aspect_ratio: ratio }
  }
  return { image_size: RATIO_TO_IMAGE_SIZE[ratio] ?? 'square_hd' }
}

export const falProvider: AIProvider = {
  name: 'fal',

  async generateImage(req: GenerationRequest): Promise<GenerationResult> {
    try {
      const input: Record<string, unknown> = {
        prompt: req.prompt,
        ...buildSizeParam(req.model, req.aspectRatio ?? '1:1'),
      }
      if (req.negativePrompt) input.negative_prompt = req.negativePrompt
      if (req.seed != null) input.seed = req.seed

      type FalImageOutput = { images?: { url: string }[]; seed?: number; inference_time?: number }
      const result = await fal.subscribe(req.model, {
        input,
        logs: false,
      })

      const data = (result as unknown as { data?: FalImageOutput }).data
      const imageUrl = data?.images?.[0]?.url
      if (!imageUrl) {
        return { id: '', status: 'failed', error: 'No image URL in response' }
      }

      return {
        id: String(data?.seed ?? Date.now()),
        status: 'completed',
        outputUrl: imageUrl,
        metadata: {
          seed: data?.seed,
          inference_time: data?.inference_time,
        },
      }
    } catch (err) {
      return {
        id: '',
        status: 'failed',
        error: (err as Error).message,
      }
    }
  },

  // fal.ai は同期方式のため checkStatus は実質使用しない
  async checkStatus(taskId: string): Promise<GenerationResult> {
    return {
      id: taskId,
      status: 'completed',
    }
  },

  getAvailableModels() {
    return [
      { id: 'black-forest-labs/flux-schnell',  name: 'FLUX Schnell',        type: 'image' as const },
      { id: 'black-forest-labs/flux-dev',       name: 'FLUX Dev',            type: 'image' as const },
      { id: 'black-forest-labs/flux-1.1-pro',   name: 'FLUX 1.1 Pro',        type: 'image' as const },
      { id: 'fal-ai/flux-2',              name: 'FLUX.2',         type: 'image' as const },
      { id: 'fal-ai/nano-banana-2',        name: 'Nano Banana 2',   type: 'image' as const },
      { id: 'fal-ai/nano-banana-pro',     name: 'Nano Banana Pro', type: 'image' as const },
    ]
  },
}
