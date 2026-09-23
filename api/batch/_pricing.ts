// エンドポイント別の単価（概算）。fal の API は請求額を返さないため、
// 実績コストは「単価 × 処理時間（inference_time）」または「1 リクエスト単価」で算出する（仕様 4-3 の「実績値」＝この算出値）。
// ⚠️ 単価は fal の料金ページに合わせて更新すること（真の請求額は fal ダッシュボードが正）。

export interface EndpointPricing {
  perRequestUsd?: number   // 1 リクエスト固定
  perSecondUsd?: number    // 計算秒課金
  assumedSeconds?: number  // 見積り用の想定処理時間（計算秒課金のとき）
}

import { USD_JPY } from '../../src/lib/batch/cost'
export { USD_JPY }

export const ENDPOINT_PRICING: Record<string, EndpointPricing> = {
  'fal-ai/bria/background/remove': { perRequestUsd: 0.018 },
  'fal-ai/birefnet/v2': { perSecondUsd: 0.0008, assumedSeconds: 1.5 },
  // 背景生成（Step 8）で使う画像生成の概算
  'fal-ai/nano-banana-2': { perRequestUsd: 0.039 },
  'fal-ai/nano-banana-pro': { perRequestUsd: 0.15 },
  'fal-ai/flux-2': { perRequestUsd: 0.03 },
  'black-forest-labs/flux-schnell': { perRequestUsd: 0.003 },
  'black-forest-labs/flux-dev': { perRequestUsd: 0.025 },
  'black-forest-labs/flux-1.1-pro': { perRequestUsd: 0.04 },
}

/** エンドポイント（サブパス付き可）に対応する単価。未登録は null。 */
export function pricingFor(endpoint: string): EndpointPricing | null {
  const keys = Object.keys(ENDPOINT_PRICING).sort((a, b) => b.length - a.length)
  const hit = keys.find((k) => endpoint === k || endpoint.startsWith(k + '/'))
  return hit ? ENDPOINT_PRICING[hit] : null
}

/** 完了したタスクの実績コスト（USD）。処理時間が不明なら想定秒数で代替。 */
export function estimateTaskCost(endpoint: string, inferenceTimeSec?: number | null): number {
  const p = pricingFor(endpoint)
  if (!p) return 0
  if (p.perRequestUsd !== undefined) return round4(p.perRequestUsd)
  const sec = typeof inferenceTimeSec === 'number' && inferenceTimeSec > 0 ? inferenceTimeSec : (p.assumedSeconds ?? 1)
  return round4((p.perSecondUsd ?? 0) * sec)
}

/** 投入前の見積り（1 タスク）。 */
export function estimatePlannedTaskCost(endpoint: string): number {
  return estimateTaskCost(endpoint, null)
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
