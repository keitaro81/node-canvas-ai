import { fal } from './fal-client';
import type {
  VideoProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoGenerationProgress,
  VideoModelDefinition,
  VideoDuration,
} from './types';

const KLING_V3_DURATIONS = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
const SEEDANCE_DURATIONS  = ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
const SEEDANCE_ASPECTS    = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

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
    supportedFps: [24, 25, 48, 50],
  },
  {
    id: 'ltx-2.3-pro',
    name: 'LTX-2.3 Pro',
    endpoint: 'fal-ai/ltx-2.3/text-to-video',
    i2vEndpoint: 'fal-ai/ltx-2.3/image-to-video',
    pricePerSecond: 0.06,
    maxDuration: '10',
    supportedDurations: ['6', '8', '10'],
    supportedResolutions: ['1080p', '1440p', '2160p'],
    supportedAspectRatios: ['16:9', '9:16'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: ['audio', '4k'],
    paramStyle: 'ltx',
    supportedModes: ['text-to-video', 'image-to-video'],
    supportedFps: [24, 25, 48, 50],
  },
  {
    id: 'kling-2.5-turbo',
    name: 'Kling 2.5 Turbo Pro',
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    i2vEndpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    pricePerSecond: 0.07,
    maxDuration: '10',
    supportedDurations: ['5', '10'],
    supportedResolutions: [],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: [],
    paramStyle: 'kling',
    supportedModes: ['text-to-video', 'image-to-video'],
  },
  {
    id: 'kling-v3-standard',
    name: 'Kling v3 Standard',
    endpoint: 'fal-ai/kling-video/v3/standard/text-to-video',
    i2vEndpoint: 'fal-ai/kling-video/v3/standard/image-to-video',
    pricePerSecond: 0.07,
    maxDuration: '15',
    supportedDurations: KLING_V3_DURATIONS,
    supportedResolutions: [],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: ['audio'],
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
    supportedDurations: KLING_V3_DURATIONS,
    supportedResolutions: [],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    i2vSupportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: ['audio'],
    paramStyle: 'kling',
    supportedModes: ['text-to-video', 'image-to-video'],
  },
  {
    id: 'seedance-2.0-fast',
    name: 'Seedance 2.0',
    endpoint: 'bytedance/seedance-2.0/text-to-video',
    pricePerSecond: 0.05,
    maxDuration: '15',
    supportedDurations: SEEDANCE_DURATIONS,
    supportedResolutions: ['480p', '720p'],
    supportedAspectRatios: [...SEEDANCE_ASPECTS],
    features: ['audio'],
    paramStyle: 'seedance',
    supportedModes: ['text-to-video'],
  },
  {
    id: 'seedance-2.0-i2v',
    name: 'Seedance 2.0 I2V',
    endpoint: 'bytedance/seedance-2.0/image-to-video',
    pricePerSecond: 0.05,
    maxDuration: '15',
    supportedDurations: SEEDANCE_DURATIONS,
    supportedResolutions: ['480p', '720p'],
    supportedAspectRatios: [...SEEDANCE_ASPECTS],
    features: ['audio'],
    paramStyle: 'seedance',
    supportedModes: ['image-to-video'],
  },
  {
    id: 'seedance-2.0-r2v',
    name: 'Seedance 2.0 Reference',
    endpoint: 'bytedance/seedance-2.0/reference-to-video',
    pricePerSecond: 0.06,
    maxDuration: '15',
    supportedDurations: SEEDANCE_DURATIONS,
    supportedResolutions: ['480p', '720p'],
    supportedAspectRatios: [...SEEDANCE_ASPECTS],
    features: ['audio'],
    paramStyle: 'seedance-r2v',
    supportedModes: ['video-to-video'],
  },
  {
    id: 'kling-o3-standard-v2v',
    name: 'Kling O3 Standard V2V',
    endpoint: 'fal-ai/kling-video/o3/standard/video-to-video/reference',
    pricePerSecond: 0.07,
    maxDuration: '15',
    supportedDurations: KLING_V3_DURATIONS,
    supportedResolutions: [],
    supportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: [],
    paramStyle: 'kling-v2v',
    supportedModes: ['video-to-video'],
  },
  {
    id: 'kling-o3-pro-v2v',
    name: 'Kling O3 Pro V2V',
    endpoint: 'fal-ai/kling-video/o3/pro/video-to-video/reference',
    pricePerSecond: 0.1,
    maxDuration: '15',
    supportedDurations: KLING_V3_DURATIONS,
    supportedResolutions: [],
    supportedAspectRatios: ['auto', '16:9', '9:16', '1:1'],
    features: [],
    paramStyle: 'kling-v2v',
    supportedModes: ['video-to-video'],
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
    } else if (modelDef.paramStyle === 'seedance' || modelDef.paramStyle === 'seedance-r2v') {
      // Seedance は 'auto' を明示的に渡す
      aspectRatio = 'auto'
    } else {
      // LTX は aspect_ratio を省略すれば自動判定してくれる
      aspectRatio = undefined
    }
  } else {
    aspectRatio = request.aspectRatio
  }

  if (modelDef.paramStyle === 'kling-v2v') {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      video_url: request.videoUrl,
      duration: safeDuration,
    }
    if (aspectRatio && aspectRatio !== 'auto') input.aspect_ratio = aspectRatio
    if (request.imageUrl) input.image_urls = [request.imageUrl]
    if (request.seed != null) input.seed = request.seed
    return input
  }

  if (modelDef.paramStyle === 'kling') {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      duration: safeDuration,
    }
    if (aspectRatio) input.aspect_ratio = aspectRatio
    if (request.imageUrl) input.image_url = request.imageUrl
    if (request.seed != null) input.seed = request.seed
    if (modelDef.features.includes('audio')) input.generate_audio = request.audioEnabled ?? false
    return input
  }

  if (modelDef.paramStyle === 'seedance') {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      resolution: request.resolution || '720p',
      duration: safeDuration,
      generate_audio: request.audioEnabled ?? true,
      aspect_ratio: aspectRatio,
    }
    if (request.imageUrl) input.image_url = request.imageUrl
    if (request.seed != null) input.seed = request.seed
    return input
  }

  if (modelDef.paramStyle === 'seedance-r2v') {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      resolution: request.resolution || '720p',
      duration: safeDuration,
      generate_audio: request.audioEnabled ?? true,
      aspect_ratio: aspectRatio,
    }
    if (request.imageUrl) input.image_urls = [request.imageUrl]
    if (request.videoUrl) input.video_urls = [request.videoUrl]
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
    onProgress?: (progress: VideoGenerationProgress) => void,
    onRequestId?: (requestId: string, endpoint: string) => void
  ): Promise<VideoGenerationResult> {
    const modelDef = VIDEO_MODELS.find((m) => m.id === request.model);
    if (!modelDef) {
      return { id: '', status: 'failed', error: `Unknown video model: ${request.model}` };
    }

    // 'auto' はそのまま渡す（Seedance が対応）
    const isAutoDuration = request.duration === 'auto'
    const requestedDuration = isAutoDuration ? 0 : parseInt(request.duration || modelDef.supportedDurations[0], 10);
    const maxDuration = parseInt(modelDef.maxDuration, 10);
    const clampedDuration = isAutoDuration ? 'auto' : String(Math.min(requestedDuration, maxDuration));
    // supportedDurations に含まれない値はリストの最近傍値にスナップ
    const safeDuration = (modelDef.supportedDurations.includes(clampedDuration)
      ? clampedDuration
      : modelDef.supportedDurations.filter((d) => d !== 'auto').reduce((prev, cur) =>
          Math.abs(parseInt(cur, 10) - requestedDuration) < Math.abs(parseInt(prev, 10) - requestedDuration) ? cur : prev
        )
    ) as VideoDuration;

    // 48/50fps は 10秒以下のみ（それ以上は 24/25fps にダウングレード）
    const reqFps = request.fps ?? 25;
    const safeFps = (reqFps === 50 || reqFps === 48) && !isAutoDuration && requestedDuration > 10
      ? (reqFps === 50 ? 25 : 24)
      : reqFps;

    try {
      const isV2V = request.mode === 'video-to-video' || modelDef.paramStyle === 'kling-v2v' || modelDef.paramStyle === 'seedance-r2v';
      const isI2V = !isV2V && !!request.imageUrl;
      const endpoint = isV2V ? modelDef.endpoint : (isI2V && modelDef.i2vEndpoint ? modelDef.i2vEndpoint : modelDef.endpoint);
      const input = await buildInput(modelDef, request, safeDuration, safeFps);
      console.log('[fal-video] request input:', input);

      const result = await fal.subscribe(endpoint, {
        input,
        logs: true,
        onEnqueue: (requestId: string) => {
          onRequestId?.(requestId, endpoint);
        },
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

  async recoverVideo(
    requestId: string,
    endpoint: string,
    onProgress?: (progress: VideoGenerationProgress) => void
  ): Promise<VideoGenerationResult> {
    try {
      await fal.queue.subscribeToStatus(endpoint, {
        requestId,
        logs: true,
        mode: 'polling',
        pollInterval: 3000,
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

      const result = await fal.queue.result(endpoint, { requestId });
      console.log('[fal-video] recovery result:', result);

      type VideoFile = { url?: string; file_name?: string; content_type?: string };
      type FalResult = { data?: { video?: VideoFile; videos?: VideoFile[] } };
      const data = (result as unknown as FalResult).data;
      const video: VideoFile | undefined = data?.video ?? data?.videos?.[0] ?? undefined;

      if (!video?.url) {
        return { id: requestId, status: 'failed', error: 'No video URL in response' };
      }

      return {
        id: requestId,
        status: 'completed',
        videoUrl: video.url,
        fileName: video.file_name || 'output.mp4',
        contentType: video.content_type || 'video/mp4',
      };
    } catch (error) {
      return {
        id: requestId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Video recovery failed',
      };
    }
  }

  getAvailableVideoModels(): VideoModelDefinition[] {
    return VIDEO_MODELS;
  }
}
