import { fal } from './fal-client';
import type {
  VideoProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoGenerationProgress,
  VideoModelDefinition,
  VideoDuration,
} from './types';

const VIDEO_MODELS: VideoModelDefinition[] = [
  {
    id: 'ltx-2.3-fast',
    name: 'LTX-2.3 Fast',
    endpoint: 'fal-ai/ltx-2.3/text-to-video/fast',
    i2vEndpoint: 'fal-ai/ltx-2.3/image-to-video/fast',
    pricePerSecond: 0.04,
    maxDuration: '20',
    supportedDurations: ['6', '8', '10', '12', '14', '16', '18', '20'],
    supportedResolutions: ['1080p', '1440p', '2160p'],
    supportedAspectRatios: ['16:9', '9:16'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: ['audio'],
    paramStyle: 'ltx',
    supportedModes: ['text-to-video', 'image-to-video'],
  },
  {
    id: 'ltx-2.3-pro',
    name: 'LTX-2.3 Pro',
    endpoint: 'fal-ai/ltx-2.3/text-to-video',
    i2vEndpoint: 'fal-ai/ltx-2.3/image-to-video',
    pricePerSecond: 0.06,
    maxDuration: '20',
    supportedDurations: ['6', '8', '10', '12', '14', '16', '18', '20'],
    supportedResolutions: ['1080p', '1440p', '2160p'],
    supportedAspectRatios: ['16:9', '9:16'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: ['audio', '4k'],
    paramStyle: 'ltx',
    supportedModes: ['text-to-video', 'image-to-video'],
  },
  {
    id: 'kling-2.5-turbo',
    name: 'Kling 2.5 Turbo',
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    i2vEndpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    pricePerSecond: 0.07,
    maxDuration: '10',
    supportedDurations: ['5', '10'],
    supportedResolutions: ['1080p'],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: [],
    paramStyle: 'kling',
    supportedModes: ['text-to-video', 'image-to-video'],
  },
  {
    id: 'kling-v3-pro',
    name: 'Kling v3 Pro',
    endpoint: 'fal-ai/kling-video/v3/pro/text-to-video',
    i2vEndpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
    pricePerSecond: 0.1,
    maxDuration: '15',
    supportedDurations: ['3', '5', '10', '15'],
    supportedResolutions: ['1080p'],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: [],
    paramStyle: 'kling',
    supportedModes: ['text-to-video', 'image-to-video'],
  },
];

/** 画像URLから自然サイズを取得し、16:9 / 9:16 / 1:1 の中で最も近い比率を返す */
async function detectAspectRatio(imageUrl: string): Promise<'16:9' | '9:16' | '1:1'> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight
      // 16:9 ≈ 1.778, 1:1 = 1.0, 9:16 ≈ 0.5625
      if (ratio >= 1.3) resolve('16:9')
      else if (ratio <= 0.75) resolve('9:16')
      else resolve('1:1')
    }
    img.onerror = () => resolve('16:9') // 取得失敗時はデフォルト
    img.src = imageUrl
  })
}

async function buildInput(
  modelDef: VideoModelDefinition,
  request: VideoGenerationRequest,
  safeDuration: string,
  safeFps: number
): Promise<Record<string, unknown>> {
  let aspectRatio: string | undefined

  if (request.aspectRatio === 'auto' || !request.aspectRatio) {
    if (modelDef.paramStyle === 'kling' && request.imageUrl) {
      // Kling は 'auto' をサポートしないため画像サイズから最近傍比率を自動検出
      aspectRatio = await detectAspectRatio(request.imageUrl)
    } else {
      // LTX は aspect_ratio を省略すれば自動判定してくれる
      aspectRatio = undefined
    }
  } else {
    aspectRatio = request.aspectRatio
  }

  if (modelDef.paramStyle === 'kling') {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      duration: safeDuration,
    }
    if (aspectRatio) input.aspect_ratio = aspectRatio
    if (request.imageUrl) input.image_url = request.imageUrl
    if (request.seed != null) input.seed = request.seed
    return input
  }

  // LTX: duration は整数
  const input: Record<string, unknown> = {
    prompt: request.prompt,
    duration: parseInt(safeDuration, 10),
    resolution: request.resolution || '1080p',
    fps: safeFps,
    generate_audio: request.audioEnabled ?? true,
  }
  if (aspectRatio) input.aspect_ratio = aspectRatio
  if (request.imageUrl) input.image_url = request.imageUrl
  if (request.seed != null) input.seed = request.seed
  return input
}

export class FalVideoProvider implements VideoProvider {
  name = 'fal-video';

  async generateVideo(
    request: VideoGenerationRequest,
    onProgress?: (progress: VideoGenerationProgress) => void
  ): Promise<VideoGenerationResult> {
    const modelDef = VIDEO_MODELS.find((m) => m.id === request.model);
    if (!modelDef) {
      return { id: '', status: 'failed', error: `Unknown video model: ${request.model}` };
    }

    const requestedDuration = parseInt(request.duration || modelDef.supportedDurations[0], 10);
    const maxDuration = parseInt(modelDef.maxDuration, 10);
    const clampedDuration = String(Math.min(requestedDuration, maxDuration));
    // supportedDurations に含まれない値はリストの最近傍値にスナップ
    const safeDuration = (modelDef.supportedDurations.includes(clampedDuration)
      ? clampedDuration
      : modelDef.supportedDurations.reduce((prev, cur) =>
          Math.abs(parseInt(cur, 10) - requestedDuration) < Math.abs(parseInt(prev, 10) - requestedDuration) ? cur : prev
        )
    ) as VideoDuration;

    const safeFps = request.fps === 50 && requestedDuration > 10 ? 25 : (request.fps ?? 25);

    try {
      const isI2V = !!request.imageUrl;
      const endpoint = isI2V && modelDef.i2vEndpoint ? modelDef.i2vEndpoint : modelDef.endpoint;
      const input = await buildInput(modelDef, request, safeDuration, safeFps);
      console.log('[fal-video] request input:', input);

      const result = await fal.subscribe(endpoint, {
        input,
        logs: true,
        onQueueUpdate: (update) => {
          if (!onProgress) return;
          if (update.status === 'IN_QUEUE') {
            onProgress({ status: 'IN_QUEUE' });
          } else if (update.status === 'IN_PROGRESS') {
            const logs =
              'logs' in update
                ? (update.logs || []).map((log: { message: string }) => log.message)
                : [];
            onProgress({ status: 'IN_PROGRESS', logs });
          } else if (update.status === 'COMPLETED') {
            onProgress({ status: 'COMPLETED' });
          }
        },
      });

      console.log('[fal-video] raw result:', result);

      // レスポンス形式の違いに対応: video / videos[0] どちらも受け取る
      type VideoFile = { url?: string; file_name?: string; content_type?: string };
      type FalResult = { data?: { video?: VideoFile; videos?: VideoFile[] } };
      const data = (result as unknown as FalResult).data;
      const video: VideoFile | undefined =
        data?.video ?? data?.videos?.[0] ?? undefined;

      if (!video?.url) {
        console.error('[fal-video] video URL not found in response. data:', data);
        return { id: String(Date.now()), status: 'failed', error: 'No video URL in response' };
      }

      return {
        id: String(Date.now()),
        status: 'completed',
        videoUrl: video.url,
        fileName: video.file_name || 'output.mp4',
        contentType: video.content_type || 'video/mp4',
        metadata: {
          model: request.model,
          endpoint: modelDef.endpoint,
          duration: safeDuration,
          resolution: request.resolution || '1080p',
          aspectRatio: request.aspectRatio || '16:9',
        },
      };
    } catch (error) {
      return {
        id: String(Date.now()),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Video generation failed',
      };
    }
  }

  getAvailableVideoModels(): VideoModelDefinition[] {
    return VIDEO_MODELS;
  }
}
