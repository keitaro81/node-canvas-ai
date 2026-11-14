// 画像生成モデルの定義と、入力の組み立て（対話実行の ImageGenerationNode と、一括実行の計画（api/batch）で同じものを使う）。
// ブラウザ固有の機能に依存しない純関数。モデルの id・表示名・選択肢はここだけに置く（画面ごとに書かない）。

// ── モデル id（ノードの params に保存される値）──
/** 既定の画像生成・編集モデル。2026-11-14 に Nano Banana 2 から切り替え（同じ系統の後継。2K で 1 枚 $0.063 と 2 の $0.12 より安い） */
export const NB_MODEL = 'google/nano-banana-2.1'
export const NB_PRO_MODEL = 'fal-ai/nano-banana-pro'
/** GPT Image 2.6（2026-11-14 に GPT-Image-2 から切り替え）。fal では 2 種類あり、flare = 標準（速い）・sunburst = 高精細（細部に強いが時間がかかる） */
export const GPT_IMAGE_MODEL = 'openai/gpt-image-2.6/flare'
export const GPT_IMAGE_HD_MODEL = 'openai/gpt-image-2.6/sunburst'
export const RECRAFT_MODEL = 'fal-ai/recraft/v4/text-to-image'
export const RECRAFT_PRO_MODEL = 'fal-ai/recraft/v4/pro/text-to-image'

// 置き換えたモデル: 保存済みのワークフロー・プロファイル・一括処理の写しに残っている id → 今の id。
// 読むたびに寄せるので、保存し直さなくても新しいモデルで動く（fal の許可リストには、進行中の依頼の確認用に旧 id も残してある）
const REPLACED_IMAGE_MODELS: Record<string, string> = {
  'fal-ai/nano-banana-2': NB_MODEL,
  'openai/gpt-image-2': GPT_IMAGE_MODEL,
}

/** 保存されているモデル id を今の id に寄せる。文字列でない・空なら undefined（呼び出し側が既定を決める） */
export function normalizeImageModel(id: unknown): string | undefined {
  if (typeof id !== 'string' || !id) return undefined
  return REPLACED_IMAGE_MODELS[id] ?? id
}

export const GPT_IMAGE_MODELS = new Set([GPT_IMAGE_MODEL, GPT_IMAGE_HD_MODEL])
export const RECRAFT_MODELS = new Set([RECRAFT_MODEL, RECRAFT_PRO_MODEL])

// ── 画面の選択肢（表示名）──
export interface ImageModelOption { value: string; label: string }
export const IMAGE_MODEL_LABELS: Record<string, string> = {
  [NB_MODEL]: 'Nano Banana 2.1',
  [NB_PRO_MODEL]: 'Nano Banana Pro',
  [RECRAFT_MODEL]: 'Recraft V4',
  [RECRAFT_PRO_MODEL]: 'Recraft V4 Pro',
  [GPT_IMAGE_MODEL]: 'GPT Image 2.6',
  [GPT_IMAGE_HD_MODEL]: 'GPT Image 2.6（高精細）',
}
const options = (ids: string[]): ImageModelOption[] => ids.map((value) => ({ value, label: IMAGE_MODEL_LABELS[value] ?? value }))
/** テキストから画像（参照画像なし） */
export const T2I_MODEL_OPTIONS = options([NB_MODEL, NB_PRO_MODEL, RECRAFT_MODEL, RECRAFT_PRO_MODEL, GPT_IMAGE_MODEL, GPT_IMAGE_HD_MODEL])
/** 参照画像つき（Nano Banana 系だけ） */
export const NB_EDIT_MODEL_OPTIONS = options([NB_MODEL, NB_PRO_MODEL])
/** 参照画像つき */
export const EDIT_MODEL_OPTIONS = options([NB_MODEL, NB_PRO_MODEL, GPT_IMAGE_MODEL, GPT_IMAGE_HD_MODEL])
/** マスクつき（部分修正）: mask_url を受け付けるのは GPT Image だけ */
export const INPAINT_MODEL_OPTIONS = options([GPT_IMAGE_MODEL, GPT_IMAGE_HD_MODEL])

// ── Nano Banana 系の解像度・比率（fal の API の許容値。2.1 は 0.5K が無い）──
export const NB_RESOLUTIONS: Record<string, string[]> = {
  [NB_MODEL]: ['1K', '2K', '4K'],
  [NB_PRO_MODEL]: ['1K', '2K', '4K'],
}
export const NB_ASPECT_RATIOS: Record<string, string[]> = {
  [NB_MODEL]: ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'],
  [NB_PRO_MODEL]: ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
}
export const NB_ASPECT_RATIOS_DEFAULT = NB_ASPECT_RATIOS[NB_MODEL]

/** その解像度がモデルで使えなければ、使える中の先頭（1K）にする。前のモデルの 0.5K が保存されたノードのため */
export function safeNbResolution(model: string, resolution: string): string {
  const supported = NB_RESOLUTIONS[model]
  return supported && !supported.includes(resolution) ? (supported[0] ?? '1K') : resolution
}
/** その比率がモデルで使えなければ 1:1 にする（auto はそのまま） */
export function safeNbAspectRatio(model: string, aspectRatio: string): string {
  const supported = NB_ASPECT_RATIOS[model]
  return supported && aspectRatio !== 'auto' && !supported.includes(aspectRatio) ? '1:1' : aspectRatio
}

// ── fal のエンドポイント ──
/** テキストから画像のエンドポイント。GPT Image 2.6 は /text-to-image が付き、ほかは id そのまま */
export function textToImageEndpointOf(model: string): string {
  const m = normalizeImageModel(model) ?? NB_MODEL
  return GPT_IMAGE_MODELS.has(m) ? `${m}/text-to-image` : m
}
/** 画像を入力にした編集のエンドポイント */
export function imageEditEndpointOf(model: string): string {
  return `${normalizeImageModel(model) ?? NB_MODEL}/edit`
}

export interface TextToImageParams {
  aspectRatio?: unknown
  resolution?: unknown
  seed?: unknown
  gptImageSize?: unknown
  recraftImageSize?: unknown
}

function seedOf(raw: unknown): number | null {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
  return s && Number.isFinite(Number(s)) ? Number(s) : null
}

/** テキストから画像（参照画像なし）の fal 入力。モデルごとの API の違いをここに閉じ込める。エンドポイントは textToImageEndpointOf */
export function buildTextToImageInput(modelId: string, prompt: string, p: TextToImageParams): Record<string, unknown> {
  const model = normalizeImageModel(modelId) ?? NB_MODEL
  const seed = seedOf(p.seed)
  if (GPT_IMAGE_MODELS.has(model)) {
    const raw = typeof p.gptImageSize === 'string' ? p.gptImageSize : ''
    return { prompt, image_size: !raw || raw === 'auto' ? 'square_hd' : raw }
  }
  if (RECRAFT_MODELS.has(model)) {
    const input: Record<string, unknown> = { prompt, image_size: typeof p.recraftImageSize === 'string' && p.recraftImageSize ? p.recraftImageSize : 'square' }
    if (seed !== null) input.seed = seed
    return input
  }
  // Nano Banana 系（既定）: aspect_ratio + resolution。対応外の値は安全な値へ
  const aspectRatio = typeof p.aspectRatio === 'string' && p.aspectRatio ? p.aspectRatio : '1:1'
  const resolution = typeof p.resolution === 'string' && p.resolution ? p.resolution : '1K'
  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: safeNbAspectRatio(model, aspectRatio),
    resolution: safeNbResolution(model, resolution),
  }
  if (seed !== null) input.seed = seed
  return input
}

export const EDIT_CAPABLE_MODELS = new Set([NB_MODEL, NB_PRO_MODEL, GPT_IMAGE_MODEL, GPT_IMAGE_HD_MODEL])

/** 編集（画像入力あり）に使うモデル。ノードの editModel を優先し、無ければ model が編集対応ならそれ、どちらでもなければ既定の Nano Banana */
export function editModelOf(p: { editModel?: unknown; model?: unknown }): string {
  const edit = normalizeImageModel(p.editModel)
  if (edit && EDIT_CAPABLE_MODELS.has(edit)) return edit
  const model = normalizeImageModel(p.model)
  if (model && EDIT_CAPABLE_MODELS.has(model)) return model
  return NB_MODEL
}

/** マスクつき（部分修正）に使うモデル。ノードで GPT Image（標準 / 高精細）を選んでいればそれ、ほかのモデルなら標準の GPT Image */
export function inpaintModelOf(editModel: unknown): string {
  const m = normalizeImageModel(editModel)
  return m && GPT_IMAGE_MODELS.has(m) ? m : GPT_IMAGE_MODEL
}

/** 画像を入力にした編集の fal エンドポイントと入力（image_urls は呼び出し側が足す）。ImageGenerationNode の編集モードと同じ規則 */
export function buildImageEditRequest(modelId: string, prompt: string, p: TextToImageParams & { gptImageSize?: unknown }): { endpoint: string; input: Record<string, unknown> } {
  const model = normalizeImageModel(modelId) ?? NB_MODEL
  const seed = seedOf(p.seed)
  if (GPT_IMAGE_MODELS.has(model)) {
    const raw = typeof p.gptImageSize === 'string' ? p.gptImageSize : ''
    return { endpoint: imageEditEndpointOf(model), input: { prompt, image_size: raw || 'square_hd' } }
  }
  const aspectRatio = typeof p.aspectRatio === 'string' && p.aspectRatio ? p.aspectRatio : '1:1'
  const resolution = typeof p.resolution === 'string' && p.resolution ? p.resolution : '1K'
  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: safeNbAspectRatio(model, aspectRatio),
    resolution: safeNbResolution(model, resolution),
  }
  if (seed !== null) input.seed = seed
  return { endpoint: imageEditEndpointOf(model), input }
}
