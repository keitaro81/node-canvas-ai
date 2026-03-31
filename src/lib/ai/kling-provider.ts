// @deprecated - fal-provider.ts に移行済み。このファイルは参照用に残しています。
import { supabase } from '../supabase'
import type { AIProvider, GenerationRequest, GenerationResult } from './types'

// Kling AI task_status → GenerationResult.status
function mapKlingStatus(
  klingStatus: string,
): GenerationResult['status'] {
  switch (klingStatus) {
    case 'submitted':
      return 'pending'
    case 'processing':
      return 'processing'
    case 'succeed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

export const klingProvider: AIProvider = {
  name: 'kling',

  async generateImage(req: GenerationRequest): Promise<GenerationResult> {
    const { data, error } = await supabase.functions.invoke('generate-image', {
      body: {
        prompt: req.prompt,
        negativePrompt: req.negativePrompt,
        aspectRatio: req.aspectRatio ?? '1:1',
        model: req.model,
      },
    })

    if (error) {
      return {
        id: '',
        status: 'failed',
        error: error.message,
      }
    }

    const taskId: string = data?.task_id ?? ''

    if (!taskId) {
      return {
        id: '',
        status: 'failed',
        error: 'No task_id returned from generate-image',
      }
    }

    return {
      id: taskId,
      status: 'pending',
    }
  },

  async checkStatus(taskId: string): Promise<GenerationResult> {
    const { data, error } = await supabase.functions.invoke('check-generation', {
      body: { task_id: taskId },
    })

    if (error) {
      return {
        id: taskId,
        status: 'failed',
        error: error.message,
      }
    }

    const status = mapKlingStatus(data?.status ?? '')
    const images: string[] = data?.images ?? []

    return {
      id: taskId,
      status,
      outputUrl: images[0],
      metadata: images.length > 1 ? { additionalImages: images.slice(1) } : undefined,
    }
  },

  getAvailableModels() {
    return [
      { id: 'kling-v1', name: 'Kling v1', type: 'image' as const },
      { id: 'kling-v1-5', name: 'Kling v1.5', type: 'image' as const },
      { id: 'kling-v2', name: 'Kling v2', type: 'image' as const },
    ]
  },
}
