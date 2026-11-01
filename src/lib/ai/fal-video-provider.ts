import { fal } from './fal-client';
import { VIDEO_MODELS, buildVideoInput, resolveAspectRatio, resolveSafeDuration, resolveSafeFps, videoEndpointFor } from './videoModels';
import type {
  VideoProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoGenerationProgress,
  VideoModelDefinition,
} from './types';

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

    const { safeDuration, requestedDuration, isAutoDuration } = resolveSafeDuration(modelDef, request.duration)
    const safeFps = resolveSafeFps(request.fps, isAutoDuration, requestedDuration)

    try {
      const { endpoint } = videoEndpointFor(modelDef, request)
      // 比率: 'auto' で Kling（3.0 以外）に開始画像があるときだけ画像を読んで決める（共有の純関数は null を返す）
      const resolved = resolveAspectRatio(modelDef, request)
      const aspectRatio = resolved === null && request.imageUrl ? await detectAspectRatio(request.imageUrl) : (resolved ?? undefined)
      const input = buildVideoInput(modelDef, request, safeDuration, safeFps, aspectRatio);
      if (import.meta.env.DEV) console.log('[fal-video] request input:', input);

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

      if (import.meta.env.DEV) console.log('[fal-video] raw result:', result);

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
      const is422 = (error as { status?: number }).status === 422
      return {
        id: String(Date.now()),
        status: 'failed',
        error: is422 ? 'content_policy_violation' : (error instanceof Error ? error.message || 'Video generation failed' : 'Video generation failed'),
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
      if (import.meta.env.DEV) console.log('[fal-video] recovery result:', result);

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
