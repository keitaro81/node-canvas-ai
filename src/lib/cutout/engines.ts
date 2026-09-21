// 背景切り抜きエンジンの定義（fal.ai 上のエンドポイント）。
// ⚠️ エンドポイントを追加したら api/fal/_allowlist.ts の BG_REMOVAL_PREFIXES も更新すること。
import type { CutoutEngine, CutoutParams } from '../../types/nodes'

export interface CutoutEngineDef {
  id: CutoutEngine
  label: string
  endpoint: string
  pricing: string
  note: string
}

export const CUTOUT_ENGINES: Record<CutoutEngine, CutoutEngineDef> = {
  bria: {
    id: 'bria',
    label: 'Bria RMBG 2.0',
    endpoint: 'fal-ai/bria/background/remove',
    pricing: '$0.018 / 枚',
    note: '商用ライセンス済みデータで学習。出力は最大 1024px（アルファを元解像度へ拡大して適用）',
  },
  birefnet: {
    id: 'birefnet',
    label: 'BiRefNet v2',
    endpoint: 'fal-ai/birefnet/v2',
    pricing: '計算秒課金（数秒 / 枚）',
    note: '髪・ファーなど細部に強い。マスクを直接出力',
  },
}

export const CUTOUT_ENGINE_IDS: CutoutEngine[] = ['bria', 'birefnet']

// fal-ai/birefnet/v2 の model enum（llms.txt 2026-09-21 確認）
export const BIREFNET_MODELS = [
  'General Use (Light)',
  'General Use (Light 2K)',
  'General Use (Heavy)',
  'Matting',
  'Portrait',
  'General Use (Dynamic)',
] as const

export const BIREFNET_RESOLUTIONS = ['1024x1024', '2048x2048', '2304x2304'] as const
const BIREFNET_DYNAMIC_MODEL = 'General Use (Dynamic)'

// 既定エンジン: BiRefNet v2（2026-09-21 テストセット 10 枚の比較で決定。速い・安い・商品の縁を欠かない）。
// Bria は商用ライセンス済み学習データの説明が必要な場合の代替として切替可能。
export const DEFAULT_CUTOUT_PARAMS: CutoutParams = {
  engine: 'birefnet',
  birefnetModel: 'General Use (Light)',
  birefnetResolution: '2048x2048',
  alphaThreshold: 8,
  featherPx: 0,
  previewBg: 'checker',
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  return Math.min(max, Math.max(min, n))
}

/** 保存値（不完全・旧形式かもしれない）を既定値で補い、範囲内に丸める。 */
export function normalizeCutoutParams(p: unknown): CutoutParams {
  const src = (p && typeof p === 'object' ? p : {}) as Partial<Record<keyof CutoutParams, unknown>>
  const engine: CutoutEngine = src.engine === 'bria' || src.engine === 'birefnet' ? src.engine : DEFAULT_CUTOUT_PARAMS.engine
  const birefnetModel = (BIREFNET_MODELS as readonly string[]).includes(src.birefnetModel as string)
    ? (src.birefnetModel as string)
    : DEFAULT_CUTOUT_PARAMS.birefnetModel
  const birefnetResolution = (BIREFNET_RESOLUTIONS as readonly string[]).includes(src.birefnetResolution as string)
    ? (src.birefnetResolution as string)
    : DEFAULT_CUTOUT_PARAMS.birefnetResolution
  const previewBg = src.previewBg === 'white' || src.previewBg === 'gray' || src.previewBg === 'checker'
    ? src.previewBg
    : DEFAULT_CUTOUT_PARAMS.previewBg
  return {
    engine,
    birefnetModel,
    birefnetResolution,
    alphaThreshold: clampInt(src.alphaThreshold, 0, 255, DEFAULT_CUTOUT_PARAMS.alphaThreshold),
    featherPx: clampInt(src.featherPx, 0, 50, DEFAULT_CUTOUT_PARAMS.featherPx),
    previewBg,
  }
}

/** 2304 は Dynamic モデルのみ有効。それ以外は 2048 に落とす。 */
export function effectiveBirefnetResolution(model: string, resolution: string): string {
  if (resolution === '2304x2304' && model !== BIREFNET_DYNAMIC_MODEL) return '2048x2048'
  return resolution
}

export interface EngineRequest {
  endpoint: string
  input: Record<string, unknown>
}

/** パラメータ → fal リクエスト。原則2: BiRefNet の前景リファインは無効化し、マスクだけを受け取る。 */
export function buildEngineRequest(params: CutoutParams, imageUrl: string): EngineRequest {
  if (params.engine === 'birefnet') {
    return {
      endpoint: CUTOUT_ENGINES.birefnet.endpoint,
      input: {
        image_url: imageUrl,
        model: params.birefnetModel,
        operating_resolution: effectiveBirefnetResolution(params.birefnetModel, params.birefnetResolution),
        output_format: 'png',
        refine_foreground: false,
        output_mask: true,
        mask_only: true,
      },
    }
  }
  return { endpoint: CUTOUT_ENGINES.bria.endpoint, input: { image_url: imageUrl } }
}

/** エンジンが返すファイルの種類: 透過 PNG（アルファを取り出す）か、マスク画像（輝度をアルファにする）か。 */
export type EngineResultKind = 'rgba' | 'mask'

export interface EngineResultFile {
  url: string
  kind: EngineResultKind
  width?: number
  height?: number
}

type FalImageFile = { url?: string; width?: number; height?: number }

/** fal の出力 JSON から、切り抜きに使うファイルを選ぶ。 */
export function pickEngineResult(engine: CutoutEngine, output: unknown): EngineResultFile {
  const o = (output && typeof output === 'object' ? output : {}) as { image?: FalImageFile; mask_image?: FalImageFile }
  if (engine === 'birefnet') {
    const f = o.mask_image?.url ? o.mask_image : o.image
    if (!f?.url) throw new Error('BiRefNet の応答にマスクが含まれていません')
    return { url: f.url, kind: 'mask', width: f.width, height: f.height }
  }
  if (!o.image?.url) throw new Error('Bria の応答に画像が含まれていません')
  return { url: o.image.url, kind: 'rgba', width: o.image.width, height: o.image.height }
}
