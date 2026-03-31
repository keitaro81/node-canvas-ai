import type { AIProvider, GenerationRequest, GenerationResult } from './types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

interface FalEdgeFunctionResponse {
  status: string
  outputUrl?: string
  seed?: number
  inference_time?: number
  error?: string
}

export const falProvider: AIProvider = {
  name: 'fal',

  async generateImage(req: GenerationRequest): Promise<GenerationResult> {
    let res: FalEdgeFunctionResponse

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          prompt: req.prompt,
          negativePrompt: req.negativePrompt,
          aspectRatio: req.aspectRatio ?? '1:1',
          model: req.model,
          seed: req.seed,
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        return {
          id: '',
          status: 'failed',
          error: `Edge Function error ${response.status}: ${text}`,
        }
      }

      res = await response.json() as FalEdgeFunctionResponse
    } catch (err) {
      return {
        id: '',
        status: 'failed',
        error: (err as Error).message,
      }
    }

    if (res.status !== 'completed' || !res.outputUrl) {
      return {
        id: '',
        status: 'failed',
        error: res.error ?? 'Unexpected response from generate-image',
      }
    }

    return {
      id: String(res.seed ?? Date.now()),
      status: 'completed',
      outputUrl: res.outputUrl,
      metadata: {
        seed: res.seed,
        inference_time: res.inference_time,
      },
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
      { id: 'fal-ai/nano-banana-2',       name: 'Nano Banana 2',  type: 'image' as const },
    ]
  },
}
