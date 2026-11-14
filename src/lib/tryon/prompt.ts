// 試着（Try-On・2026-11-01・設計 docs/specs/library-tryon.md §7）: Nano Banana（2026-11-14 から 2.1）の edit に渡す試着用の既定プロンプト。
// 試作で分かったこと: 「2 枚目の服だけを着せ、それ以外（人物・ポーズ・インナー・ボトム・バッグ）は出さない。1 枚目はそのまま」と明記しないと、
// 着用写真の人物のポーズ・インナー・小物まで写し取る。ユーザーは「服の説明・補足」（任意・日本語可 → 生成時に英訳）だけ書く。
// サーバー（一括実行・2b-3）でも同じ文を使えるよう、ブラウザに依存しない純関数にしておく。
import { CUT_ROLES, type CutRole } from '../video/productVideo'
import { NB_MODEL } from '../ai/imageGenModels'

// エンジンは既定の Nano Banana（2.1）。BEAMS の服での比較（2026-11-14）で、2 と同等以上・料金は約半分だった
export const TRY_ON_MODEL = NB_MODEL
// ノードのハンドル名（BaseNode の規約 in-<port>-<id> / out-<port>-<id>。出力は Image Generation と同じ id にして Image Display の fallback も効くように）
export const TRY_ON_MODEL_HANDLE = 'in-image-model'
export const TRY_ON_GARMENT_HANDLE = 'in-image-garment'
export const TRY_ON_OUTPUT_HANDLE = 'out-image-image-out'
export const TRY_ON_ENDPOINT = `${TRY_ON_MODEL}/edit`
export const TRY_ON_RESOLUTIONS = ['1K', '2K'] as const
export type TryOnResolution = (typeof TRY_ON_RESOLUTIONS)[number]
export const TRY_ON_DEFAULT_RESOLUTION: TryOnResolution = '2K'

/** 試着の設定（ノードの params） */
export interface TryOnParams {
  resolution: TryOnResolution
  note: string            // 服の説明・補足（任意・日本語可。例: ニットカーディガン。ボタンは開けたまま）
  role?: CutRole          // 向きの予定（テンプレートが付ける。「モデル」で選ぶときの既定・他の Try-On への一括適用に使う。実際の向きは選んだカットで決まる）
}
export const DEFAULT_TRY_ON_PARAMS: TryOnParams = { resolution: TRY_ON_DEFAULT_RESOLUTION, note: '' }
export const isCutRole = (r: unknown): r is CutRole => typeof r === 'string' && CUT_ROLES.some((x) => x.id === r)

export function normalizeTryOnParams(raw: unknown): TryOnParams {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const resolution = (TRY_ON_RESOLUTIONS as readonly string[]).includes(String(p.resolution)) ? (p.resolution as TryOnResolution) : TRY_ON_DEFAULT_RESOLUTION
  return { resolution, note: typeof p.note === 'string' ? p.note : '', ...(isCutRole(p.role) ? { role: p.role } : {}) }
}

/**
 * 試着プロンプト。garment = 服の説明（英語。空なら汎用の言い方）、extra = 補足の指示（英語。空なら無し）。
 * 画像の並びは [モデル, 服] で固定（1 枚目 = 人物、2 枚目 = 服）。
 */
export function tryOnPrompt(garment: string, extra = ''): string {
  const which = garment.trim() || 'the main garment that is the product'
  const base =
    `Virtual try-on. Put ONLY ${which} from the second image onto the person in the first image. ` +
    'If the second image shows a person wearing it, ignore everything else in that image: its person, pose, hands, inner clothing, bottoms, shoes, bag and accessories must NOT appear in the result. ' +
    'Keep the first image exactly as it is except for adding that garment: same face, hair, pose, position of arms and hands, inner top, bottoms, shoes, legwear, accessories, framing, camera angle, lighting and background. ' +
    'Reproduce the garment faithfully: same shape, fit, length, colors, pattern, buttons and material. Photorealistic e-commerce fashion photo.'
  const e = extra.trim()
  return e ? `${base} ${e}` : base
}

/** 服の説明・補足の欄（日本語可）を、英訳表を使ってプロンプトに差し込む。欄は 1 つで「服の説明。補足」の順に書く想定（英訳はそのまま末尾に足す） */
export function tryOnPromptFromNote(note: string, translations: Record<string, string> = {}): string {
  const t = note.trim()
  if (!t) return tryOnPrompt('')
  const en = translations[t] ?? t
  return tryOnPrompt('', en)
}

/** fal の入力（image_urls は呼び出し側が [モデル, 服] の順で足す） */
export function buildTryOnInput(prompt: string, p: TryOnParams): Record<string, unknown> {
  return { prompt, resolution: p.resolution, aspect_ratio: 'auto' }
}
