// エンドポイント別の単価（概算）。fal の API は請求額を返さないため、
// 実績コストは「単価 × 処理時間（inference_time）」または「1 リクエスト単価」で算出する（仕様 4-3 の「実績値」＝この算出値）。
// ⚠️ 単価は fal の料金ページに合わせて更新すること（真の請求額は fal ダッシュボードが正）。

export interface EndpointPricing {
  perRequestUsd?: number       // 1 リクエスト固定
  perSecondUsd?: number        // 計算秒課金
  perVideoSecondUsd?: number   // 生成する動画の秒数課金（input.duration を使う）
  perVideoSecondUsdWithAudio?: number                      // 音声ありの動画秒課金（input.generate_audio が true のとき・Kling v3 Pro / o3 Pro）
  perVideoSecondUsdByResolution?: Record<string, number>   // 解像度ごとの動画秒課金（input.resolution・LTX）
  assumedSeconds?: number      // 見積り用の想定秒数（計算秒課金 / 動画秒課金で duration 不明のとき）
}

import { USD_JPY } from '../../src/lib/batch/cost'
import { VIDEO_MODELS } from '../../src/lib/ai/videoModels'
export { USD_JPY }

// 動画: 単価は src/lib/ai/videoModels.ts の表から（text-to-video と image-to-video の両方のエンドポイント・2026-11-02 に fal の料金ページへ合わせた）。
// 想定秒数はそのモデルの最短の長さ
const VIDEO_ENDPOINT_PRICING: Record<string, EndpointPricing> = Object.fromEntries(VIDEO_MODELS.flatMap((m) => {
  const p: EndpointPricing = {
    perVideoSecondUsd: m.pricePerSecond,
    perVideoSecondUsdWithAudio: m.pricePerSecondWithAudio,
    perVideoSecondUsdByResolution: m.pricePerSecondByResolution,
    assumedSeconds: Number(m.supportedDurations.find((d) => d !== 'auto')) || 5,
  }
  return [m.endpoint, m.i2vEndpoint].filter((e): e is string => !!e).map((e) => [e, p] as const)
}))

export const ENDPOINT_PRICING: Record<string, EndpointPricing> = {
  'fal-ai/bria/background/remove': { perRequestUsd: 0.018 },
  'fal-ai/birefnet/v2': { perSecondUsd: 0.0008, assumedSeconds: 1.5 },
  // 背景生成（Step 8）で使う画像生成の概算
  'fal-ai/nano-banana-2': { perRequestUsd: 0.039 },
  'fal-ai/nano-banana-pro': { perRequestUsd: 0.15 },
  'openai/gpt-image-2': { perRequestUsd: 0.05 },           // 概算（品質・サイズで変動。fal の料金ページで更新すること）
  'fal-ai/flux-2': { perRequestUsd: 0.03 },
  'black-forest-labs/flux-schnell': { perRequestUsd: 0.003 },
  'black-forest-labs/flux-dev': { perRequestUsd: 0.025 },
  'black-forest-labs/flux-1.1-pro': { perRequestUsd: 0.04 },
  // 動画（2026-10-13〜）: 動画 1 秒あたり（上の VIDEO_ENDPOINT_PRICING）、結合（ffmpeg）は実質無料
  ...VIDEO_ENDPOINT_PRICING,
  'fal-ai/ffmpeg-api/merge-videos': { perRequestUsd: 0 },
}

/** エンドポイント（サブパス付き可）に対応する単価。未登録は null。 */
export function pricingFor(endpoint: string): EndpointPricing | null {
  const keys = Object.keys(ENDPOINT_PRICING).sort((a, b) => b.length - a.length)
  const hit = keys.find((k) => endpoint === k || endpoint.startsWith(k + '/'))
  return hit ? ENDPOINT_PRICING[hit] : null
}

/** 完了したタスクの実績コスト（USD）。処理時間が不明なら想定秒数で代替。動画秒課金は input.duration（秒）× 単価（解像度・音声で変わるものは input から） */
export function estimateTaskCost(endpoint: string, inferenceTimeSec?: number | null, input?: Record<string, unknown> | null): number {
  const p = pricingFor(endpoint)
  if (!p) return 0
  if (p.perRequestUsd !== undefined) return round4(p.perRequestUsd)
  if (p.perVideoSecondUsd !== undefined) {
    const d = Number(input?.duration)
    const byRes = typeof input?.resolution === 'string' ? p.perVideoSecondUsdByResolution?.[input.resolution] : undefined
    const unit = byRes ?? (input?.generate_audio === true && p.perVideoSecondUsdWithAudio !== undefined ? p.perVideoSecondUsdWithAudio : p.perVideoSecondUsd)
    return round4(unit * (Number.isFinite(d) && d > 0 ? d : (p.assumedSeconds ?? 5)))
  }
  const sec = typeof inferenceTimeSec === 'number' && inferenceTimeSec > 0 ? inferenceTimeSec : (p.assumedSeconds ?? 1)
  return round4((p.perSecondUsd ?? 0) * sec)
}

/** 投入前の見積り（1 タスク）。動画は計画した秒数で */
export function estimatePlannedTaskCost(endpoint: string, input?: Record<string, unknown> | null): number {
  return estimateTaskCost(endpoint, null, input)
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
