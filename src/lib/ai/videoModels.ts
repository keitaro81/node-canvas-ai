// 動画モデルの定義と fal 入力の組み立て（純関数）。対話実行（fal-video-provider.ts）と一括実行（api/batch の計画・投入）で同じものを使う。
// ブラウザ固有の機能（画像の読み込みなど）に依存しない。比率 'auto' の解決は呼び出し側（ブラウザは画像を読む / サーバーはアイテムの寸法）
import type { VideoDuration, VideoGenerationRequest, VideoModelDefinition } from './types'
import { buildKlingElements, buildMultiPrompt } from './videoShots'

const KLING_V3_DURATIONS = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
const SEEDANCE_DURATIONS  = ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
const SEEDANCE_ASPECTS    = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

export const VIDEO_MODELS: VideoModelDefinition[] = [
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
    features: ['audio'],
    paramStyle: 'ltx',
    supportedModes: ['text-to-video'],
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
    features: ['audio', '4k'],
    paramStyle: 'ltx',
    supportedModes: ['text-to-video'],
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
    features: [],
    paramStyle: 'kling',
    supportedModes: ['text-to-video', 'image-to-video'],
    endImageParam: 'tail_image_url',
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
    features: ['audio', 'elements', 'multi-shot'],   // elements = 参照カット（正面 + 別角度）、multi-shot = multi_prompt
    paramStyle: 'kling',
    supportedModes: ['text-to-video', 'image-to-video'],
    endImageParam: 'end_image_url',
    startImageParam: 'start_image_url',               // fal docs（2026-10）: v3 の image-to-video は start_image_url
  },
  {
    id: 'kling-o3-pro-i2v',
    name: 'Kling o3 Pro',
    endpoint: 'fal-ai/kling-video/o3/pro/image-to-video',
    pricePerSecond: 0.1,
    maxDuration: '15',
    supportedDurations: KLING_V3_DURATIONS,
    supportedResolutions: [],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    features: ['audio'],
    paramStyle: 'kling-o3-i2v',
    supportedModes: ['image-to-video'],
    endImageParam: 'end_image_url',
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
    name: 'Seedance 2.0',
    endpoint: 'bytedance/seedance-2.0/image-to-video',
    pricePerSecond: 0.05,
    maxDuration: '15',
    supportedDurations: SEEDANCE_DURATIONS,
    supportedResolutions: ['480p', '720p'],
    supportedAspectRatios: [...SEEDANCE_ASPECTS],
    features: ['audio'],
    paramStyle: 'seedance',
    supportedModes: ['image-to-video'],
    endImageParam: 'end_image_url',
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

export function videoModelById(id: unknown): VideoModelDefinition | null {
  return VIDEO_MODELS.find((m) => m.id === id) ?? null
}

/** 要求した秒数をモデルの対応秒数に収める（上限で切り、リストに無ければ最近傍）。'auto' は Seedance だけがそのまま通す */
export function resolveSafeDuration(modelDef: VideoModelDefinition, duration: string | undefined): { safeDuration: VideoDuration; requestedDuration: number; isAutoDuration: boolean } {
  const isAutoDuration = duration === 'auto'
  const requestedDuration = isAutoDuration ? 0 : parseInt(duration || modelDef.supportedDurations[0], 10)
  const maxDuration = parseInt(modelDef.maxDuration, 10)
  const clampedDuration = isAutoDuration ? 'auto' : String(Math.min(requestedDuration, maxDuration))
  const safeDuration = (modelDef.supportedDurations.includes(clampedDuration)
    ? clampedDuration
    : modelDef.supportedDurations.filter((d) => d !== 'auto').reduce((prev, cur) =>
        Math.abs(parseInt(cur, 10) - requestedDuration) < Math.abs(parseInt(prev, 10) - requestedDuration) ? cur : prev
      )
  ) as VideoDuration
  return { safeDuration, requestedDuration, isAutoDuration }
}

/** 48/50fps は 10 秒以下のみ（それ以上は 24/25fps にダウングレード） */
export function resolveSafeFps(reqFps: number | undefined, isAutoDuration: boolean, requestedDuration: number): number {
  const fps = reqFps ?? 25
  return (fps === 50 || fps === 48) && !isAutoDuration && requestedDuration > 10 ? (fps === 50 ? 25 : 24) : fps
}

/** モード（参照動画 / 開始画像 / テキストのみ）に応じたエンドポイント */
export function videoEndpointFor(modelDef: VideoModelDefinition, request: Pick<VideoGenerationRequest, 'mode' | 'imageUrl'>): { endpoint: string; isV2V: boolean; isI2V: boolean } {
  const isV2V = request.mode === 'video-to-video' || modelDef.paramStyle === 'kling-v2v' || modelDef.paramStyle === 'seedance-r2v'
  const isI2V = !isV2V && !!request.imageUrl
  const endpoint = isV2V ? modelDef.endpoint : (isI2V && modelDef.i2vEndpoint ? modelDef.i2vEndpoint : modelDef.endpoint)
  return { endpoint, isV2V, isI2V }
}

/** 幅と高さから 16:9 / 9:16 / 1:1 のうち最も近い比率（Kling は 'auto' を受けないため。対話実行の画像判定と同じしきい値） */
export function nearestAspectRatio(width: number | null | undefined, height: number | null | undefined, supported: string[] = ['16:9', '9:16', '1:1']): string {
  const w = Number(width), h = Number(height)
  if (!(w > 0 && h > 0)) return supported.includes('16:9') ? '16:9' : supported[0]
  const ratio = w / h
  const basic = ratio >= 1.3 ? '16:9' : ratio <= 0.75 ? '9:16' : '1:1'
  if (supported.includes(basic)) return basic
  // 対応表が違うモデル: 比率の対数距離が最小のもの（'auto' は除く）
  const cands = supported.filter((s) => /^\d+:\d+$/.test(s))
  if (!cands.length) return basic
  return cands.reduce((best, s) => {
    const [a, b] = s.split(':').map(Number)
    const d = Math.abs(Math.log(a / b) - Math.log(ratio))
    const [ba, bb] = best.split(':').map(Number)
    return d < Math.abs(Math.log(ba / bb) - Math.log(ratio)) ? s : best
  }, cands[0])
}

/**
 * 比率の決め方（'auto' / 未指定のとき）。Kling は 'auto' を受けないので開始画像の寸法から最近傍（dims が無ければ null = 呼び出し側が画像を読む）、
 * Seedance は 'auto' を明示、LTX は省略（自動判定）。Kling 3.0 の image-to-video は比率を受けず開始画像の比率になるので省略
 */
export function resolveAspectRatio(modelDef: VideoModelDefinition, request: Pick<VideoGenerationRequest, 'aspectRatio' | 'imageUrl'>, dims?: { width?: number | null; height?: number | null } | null): string | undefined | null {
  if (request.aspectRatio && request.aspectRatio !== 'auto') return request.aspectRatio
  if (modelDef.paramStyle === 'kling' && request.imageUrl) {
    if (modelDef.startImageParam) return undefined   // Kling 3.0 i2v: 送らない
    return dims ? nearestAspectRatio(dims.width, dims.height) : null
  }
  if (modelDef.paramStyle === 'seedance' || modelDef.paramStyle === 'seedance-r2v') return 'auto'
  return undefined
}

/** fal に送る入力（URL も含めてそのまま）。aspectRatio は resolveAspectRatio で決めたもの */
export function buildVideoInput(
  modelDef: VideoModelDefinition,
  request: VideoGenerationRequest,
  safeDuration: string,
  safeFps: number,
  aspectRatio: string | undefined,
): Record<string, unknown> {
  if (modelDef.paramStyle === 'kling-o3-i2v') {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      duration: safeDuration,
    }
    if (aspectRatio) input.aspect_ratio = aspectRatio
    if (request.imageUrl) input.image_url = request.imageUrl
    if (request.endImageUrl && modelDef.endImageParam) input[modelDef.endImageParam] = request.endImageUrl
    if (request.seed != null) input.seed = request.seed
    if (modelDef.features.includes('audio')) input.generate_audio = request.audioEnabled ?? false
    if (request.negativePrompt) input.negative_prompt = request.negativePrompt
    return input
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
    // Kling 3.0 の image-to-video は aspect_ratio を受けず開始画像の比率になる（fal docs）。それ以外は従来どおり送る
    const omitAspect = !!modelDef.startImageParam && !!request.imageUrl
    if (aspectRatio && !omitAspect) input.aspect_ratio = aspectRatio
    if (request.imageUrl) input[modelDef.startImageParam ?? 'image_url'] = request.imageUrl
    if (request.endImageUrl && modelDef.endImageParam) input[modelDef.endImageParam] = request.endImageUrl
    if (request.seed != null) input.seed = request.seed
    if (modelDef.features.includes('audio')) input.generate_audio = request.audioEnabled ?? false
    if (request.negativePrompt) input.negative_prompt = request.negativePrompt
    if (request.cfgScale != null) input.cfg_scale = request.cfgScale
    // 参照カット（Kling 3.0 elements）: 人物と服の見え方を動画全体で保つ
    if (modelDef.features.includes('elements')) {
      const elements = buildKlingElements(request.elements)
      if (elements.length) input.elements = elements
    }
    // マルチショット: prompt の代わりに multi_prompt（API は両方は不可）。全体の長さはショットの合計
    if (modelDef.features.includes('multi-shot')) {
      const multi = buildMultiPrompt(request.shots, request.prompt)
      if (multi) { delete input.prompt; input.multi_prompt = multi.multi_prompt; input.duration = multi.duration }
    }
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
    if (request.endImageUrl && modelDef.endImageParam) input[modelDef.endImageParam] = request.endImageUrl
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
