// チャットでワークフローを組む（2026-11-01・段階 1）: LLM に渡す「ノードのカタログ」と、DSL（種別・ポート名）→ 実際のノード data・ハンドル id の対応。
// ハンドル id はノードの実装と同じ定数から取る（ずれたら catalog.test.ts が落ちる）。画面用の表示ノード（Image Display / Video Result）は実行時に自動で作られるので載せない
import type { PortType } from '../../types/nodes'
import { CUT_ROLES, CUT_ROLE_LABEL, DEFAULT_NEGATIVE_PROMPT, type CutRole } from '../video/productVideo'
import { PRODUCT_VIDEO_DEFAULT_MODEL, REMOVE_BACKGROUND_INPUT, VIDEO_GEN_END_HANDLE, VIDEO_GEN_START_HANDLE, VIDEO_MERGE_MAX_INPUTS, VIDEO_OUTPUT_HANDLE, cutSetRoleHandle } from '../batch/plan'
import { REMOVE_BACKGROUND_OUTPUT_HANDLE } from '../cutout/upstream'
import { PRODUCT_LAYOUT_INPUT_BACKGROUND, PRODUCT_LAYOUT_INPUT_CUTOUT, PRODUCT_LAYOUT_OUTPUT } from '../layout/nodeIo'
import { DEFAULT_LAYOUT_PARAMS, normalizeLayoutParams } from '../layout/computeLayout'
import { DEFAULT_CUTOUT_PARAMS, normalizeCutoutParams } from '../cutout/engines'
import { DEFAULT_EXPORT_PARAMS, normalizeExportParams, isReservedVariantName } from '../export/naming'
import { DEFAULT_BATCH_INPUT_PARAMS, normalizeBatchInputParams } from '../batch/items'
import { DEFAULT_TRY_ON_PARAMS, TRY_ON_GARMENT_HANDLE, TRY_ON_MODEL_HANDLE, TRY_ON_OUTPUT_HANDLE, TRY_ON_RESOLUTIONS, normalizeTryOnParams } from '../tryon/prompt'
import { MODEL_ROLES } from '../library/modelRoles'
import { VIDEO_MODELS, canStartFromImage } from '../ai/videoModels'
import { NB_ASPECT_RATIOS_DEFAULT, NB_RESOLUTIONS } from '../ai/imageGenModels'

export const EXPORT_ITEM_INPUT = 'in-item-item'          // ExportNode の EXPORT_ITEM_HANDLE と同じ（コンポーネントを lib から import しない）
export const EXPORT_IMAGE_SLOT_PREFIX = 'in-image-'      // in-image-0, in-image-1 …
export const EXPORT_VIDEO_SLOT_PREFIX = 'in-video-v'     // in-video-v0 …
export const IMAGE_GEN_TEXT_INPUT = 'in-text'
export const IMAGE_GEN_OUTPUT = 'out-image-image-out'
export const TEXT_PROMPT_OUTPUT = 'out-text-text-out'
export const REFERENCE_IMAGE_OUTPUT = 'out-image'
export const BATCH_INPUT_IMAGE_OUTPUT = 'out-image-image'
export const BATCH_INPUT_ITEM_OUTPUT = 'out-item-item'

/** 複数つなげる入力のハンドルの付け方 */
export type MultiKind = 'slot0' | 'slot1' | 'imageGenRef'
export interface CatalogPort { port: string; handle: string; kind: PortType; label: string; multi?: { kind: MultiKind; max: number }; acceptsCutout?: boolean }
export interface CatalogParam { key: string; type: 'string' | 'number' | 'boolean' | 'enum'; default?: unknown; enum?: readonly string[]; description: string }
export interface CatalogNode {
  type: string
  rfType: string
  label: string
  description: string
  inputs: CatalogPort[]
  outputs: CatalogPort[]
  params: CatalogParam[]
  height: number
  build: (label: string, params: Record<string, unknown>) => Record<string, unknown>
}

const IMAGE_GEN_MODELS = ['fal-ai/nano-banana-2', 'fal-ai/nano-banana-pro', 'openai/gpt-image-2', 'fal-ai/flux-2', 'fal-ai/recraft/v4/text-to-image'] as const
const VIDEO_MODEL_IDS = VIDEO_MODELS.filter(canStartFromImage).map((m) => m.id)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => ((allowed as readonly string[]).includes(v as string) ? (v as T) : d)

export const NODE_CATALOG: CatalogNode[] = [
  {
    type: 'batchInput', rfType: 'batchInputNode', label: 'Batch Input', height: 480,
    description: '一括処理の入口。商品写真を複数入れ、1 枚ずつ後段に流す（写真 1 枚 = 1 アイテム・最大 50）。SKU はファイル名から取る',
    inputs: [],
    outputs: [{ port: 'image', handle: BATCH_INPUT_IMAGE_OUTPUT, kind: 'image', label: '写真' }, { port: 'item', handle: BATCH_INPUT_ITEM_OUTPUT, kind: 'item', label: 'アイテム情報（SKU・ファイル名）' }],
    params: [{ key: 'skuPattern', type: 'string', default: DEFAULT_BATCH_INPUT_PARAMS.skuPattern, description: 'ファイル名から SKU を取る正規表現（通常は既定のまま）' }],
    build: (label, p) => ({ type: 'batchInput', label, params: normalizeBatchInputParams({ ...DEFAULT_BATCH_INPUT_PARAMS, ...p }), status: 'idle', items: [], currentItemId: null }),
  },
  {
    type: 'referenceImage', rfType: 'referenceImageNode', label: 'Reference Image', height: 400,
    description: '固定の画像 1 枚（ユーザーがアップロード / ライブラリから選ぶ）。商品写真・服・モデルなど。role は「どの向きの写真を入れるか」の案内（見出しが「Reference Image（正面）」になる）と、組むときの回転の指示文にだけ使う（ノードに向きは残らない）',
    inputs: [],
    outputs: [{ port: 'image', handle: REFERENCE_IMAGE_OUTPUT, kind: 'image', label: '画像' }],
    params: [{ key: 'role', type: 'enum', enum: ['none', ...CUT_ROLES.map((r) => r.id)], default: 'none', description: '入れる写真の向き（正面 front / 右側面 right / 左側面 left / 背面 back / ディテール detail / 全身 full）。多角度の動画で始点・終点に使う写真に付ける' }],
    build: (label, p) => ({ type: 'referenceImage', label, imageUrl: null, uploadedImagePreview: null, status: 'idle', ...(isCutRoleId(p.role) ? { photoHint: CUT_ROLE_LABEL[p.role] } : {}) }),
  },
  {
    type: 'libraryModel', rfType: 'libraryModelNode', label: 'Model', height: 300,
    description: 'ライブラリに登録したモデル（人物）。ユーザーが作ったあとにノードでモデルを選ぶと、向きごとの出力（正面 / 右側面 / 左側面 / 背面）にそのモデルの写真が入る。Try-On の model には、服のカットと同じ向きの出力をつなぐ。1 つの Model ノードから複数の Try-On につなげる',
    inputs: [],
    outputs: MODEL_ROLES.map((r) => ({ port: r.id, handle: cutSetRoleHandle(r.id), kind: 'image' as PortType, label: `${r.label}のモデル写真` })),
    params: [],
    build: (label) => ({ type: 'libraryModel', label, params: {}, status: 'idle', modelId: null, modelName: null, cuts: {} }),
  },
  {
    type: 'referenceVideo', rfType: 'referenceVideoNode', label: 'Reference Video', height: 400,
    description: '固定の動画 1 本（アップロード / ライブラリ）',
    inputs: [],
    outputs: [{ port: 'video', handle: VIDEO_OUTPUT_HANDLE, kind: 'video', label: '動画' }],
    params: [],
    build: (label) => ({ type: 'referenceVideo', label, videoUrl: null, uploadedVideoPreview: null, status: 'idle' }),
  },
  {
    type: 'textPrompt', rfType: 'textPromptNode', label: 'Text Prompt', height: 260,
    description: 'テキスト（プロンプト）。Image Generation / Video Generation の text につなぐ。日本語でよい（動画は生成時に英訳される）',
    inputs: [],
    outputs: [{ port: 'text', handle: TEXT_PROMPT_OUTPUT, kind: 'text', label: 'テキスト' }],
    params: [{ key: 'prompt', type: 'string', default: '', description: 'プロンプトの本文' }],
    build: (label, p) => ({ type: 'textPrompt', label, params: { prompt: str(p.prompt) }, status: 'idle' }),
  },
  {
    type: 'imageGen', rfType: 'imageGenerationNode', label: 'Image Generation', height: 560,
    description: 'AI 画像生成・編集。text に Text Prompt を必ずつなぐ。image に画像（写真・切り抜き・他の結果）をつなぐと編集（レタッチ・合成・背景差し替え）。一括処理では写真ごとに動く（AI 段）。背景だけを 1 回作るときは executionScope を job にして Product Layout の background につなぐ',
    inputs: [{ port: 'text', handle: IMAGE_GEN_TEXT_INPUT, kind: 'text', label: 'プロンプト' }, { port: 'image', handle: 'in-image', kind: 'image', label: '参照画像（複数可）', multi: { kind: 'imageGenRef', max: 10 }, acceptsCutout: true }],
    outputs: [{ port: 'image', handle: IMAGE_GEN_OUTPUT, kind: 'image', label: '生成画像' }],
    params: [
      { key: 'model', type: 'enum', enum: IMAGE_GEN_MODELS, default: 'fal-ai/nano-banana-2', description: '生成モデル（既定の Nano Banana 2 が編集もできる）' },
      { key: 'aspectRatio', type: 'enum', enum: NB_ASPECT_RATIOS_DEFAULT, default: '1:1', description: '比率' },
      { key: 'resolution', type: 'enum', enum: NB_RESOLUTIONS['fal-ai/nano-banana-2'], default: '1K', description: '解像度' },
      { key: 'executionScope', type: 'enum', enum: ['item', 'job'], default: 'item', description: '一括処理での動き方: item = 写真ごと、job = ジョブで 1 回（背景生成）' },
    ],
    build: (label, p) => {
      const model = pick(p.model, IMAGE_GEN_MODELS, 'fal-ai/nano-banana-2')
      return { type: 'imageGen', label, params: { model, editModel: model === 'fal-ai/nano-banana-pro' || model === 'openai/gpt-image-2' ? model : 'fal-ai/nano-banana-2', aspectRatio: pick(p.aspectRatio, NB_ASPECT_RATIOS_DEFAULT, '1:1'), resolution: pick(p.resolution, NB_RESOLUTIONS['fal-ai/nano-banana-2'], '1K'), seed: '', executionScope: pick(p.executionScope, ['item', 'job'] as const, 'item') }, status: 'idle' }
    },
  },
  {
    type: 'removeBackground', rfType: 'removeBackgroundNode', label: 'Remove Background', height: 520,
    description: '商品写真の背景を切り抜く（AI 段）。背景処理（切り抜き・白背景・透過）を求められたときだけ使う。出力は「切り抜き」で Product Layout の cutout につなぐ（Image Generation / Try-On の画像入力にもつなげるが、試着・動画の前段には不要）',
    inputs: [{ port: 'image', handle: REMOVE_BACKGROUND_INPUT, kind: 'image', label: '写真' }],
    outputs: [{ port: 'cutout', handle: REMOVE_BACKGROUND_OUTPUT_HANDLE, kind: 'cutout', label: '切り抜き' }],
    params: [
      { key: 'engine', type: 'enum', enum: ['birefnet', 'bria'], default: DEFAULT_CUTOUT_PARAMS.engine, description: '切り抜きエンジン（通常は既定）' },
      { key: 'featherPx', type: 'number', default: DEFAULT_CUTOUT_PARAMS.featherPx, description: '縁のぼかし px' },
    ],
    build: (label, p) => ({ type: 'removeBackground', label, params: normalizeCutoutParams({ ...DEFAULT_CUTOUT_PARAMS, ...p }), status: 'idle' }),
  },
  {
    type: 'productLayout', rfType: 'productLayoutNode', label: 'Product Layout', height: 700,
    description: '切り抜きを規定サイズの画像に配置（余白・背景色/背景画像/透過・影）。EC 用の白背景 1200×1200 など。1 つの Product Layout = 1 つのバリアント（variantName）',
    inputs: [{ port: 'cutout', handle: PRODUCT_LAYOUT_INPUT_CUTOUT, kind: 'cutout', label: '切り抜き' }, { port: 'background', handle: PRODUCT_LAYOUT_INPUT_BACKGROUND, kind: 'image', label: '背景画像（任意）' }],
    outputs: [{ port: 'image', handle: PRODUCT_LAYOUT_OUTPUT, kind: 'image', label: '配置した画像' }],
    params: [
      { key: 'variantName', type: 'string', default: DEFAULT_LAYOUT_PARAMS.variantName, description: 'バリアント名（ファイル名・フォルダ名に使う。例 ec_white。cutout は切り抜き PNG 用の予約名なので使わない）' },
      { key: 'width', type: 'number', default: DEFAULT_LAYOUT_PARAMS.width, description: '出力の幅 px' },
      { key: 'height', type: 'number', default: DEFAULT_LAYOUT_PARAMS.height, description: '出力の高さ px' },
      { key: 'backgroundKind', type: 'enum', enum: ['color', 'image', 'transparent'], default: 'color', description: '背景: 単色 / 背景画像（background 入力）/ 透過' },
      { key: 'backgroundColor', type: 'string', default: DEFAULT_LAYOUT_PARAMS.backgroundColor, description: '背景色 #RRGGBB' },
      { key: 'marginTop', type: 'number', default: DEFAULT_LAYOUT_PARAMS.marginTop, description: '余白 %（marginRight / marginBottom / marginLeft も同じ）' },
      { key: 'shadowKind', type: 'enum', enum: ['none', 'drop', 'contact'], default: 'none', description: '影' },
    ],
    build: (label, p) => {
      const params = normalizeLayoutParams({ ...DEFAULT_LAYOUT_PARAMS, ...p })
      // cutout は切り抜き PNG の予約名（2026-11-02 メモ 44）。チャットが付けても別名にする
      return { type: 'productLayout', label, params: isReservedVariantName(params.variantName) ? { ...params, variantName: 'cutout_layout' } : params, status: 'idle' }
    },
  },
  {
    type: 'export', rfType: 'exportNode', label: 'Export', height: 520,
    description: '書き出し（ZIP）。image に画像（複数可・1 枚ずつ別のスロット）、video に動画（複数可）、item にアイテム情報をつなぐと {sku}_{variant}_{index:02} のような名前で書き出す',
    inputs: [
      { port: 'image', handle: EXPORT_IMAGE_SLOT_PREFIX, kind: 'image', label: '画像', multi: { kind: 'slot0', max: 10 } },
      { port: 'video', handle: EXPORT_VIDEO_SLOT_PREFIX, kind: 'video', label: '動画', multi: { kind: 'slot0', max: 10 } },
      { port: 'item', handle: EXPORT_ITEM_INPUT, kind: 'item', label: 'アイテム情報' },
    ],
    outputs: [],
    params: [
      { key: 'namePattern', type: 'string', default: DEFAULT_EXPORT_PARAMS.namePattern, description: 'ファイル名の規則' },
      { key: 'format', type: 'enum', enum: ['jpeg', 'png', 'webp'], default: 'jpeg', description: '画像の形式' },
      { key: 'zipFolders', type: 'enum', enum: ['variant', 'sku', 'none'], default: 'variant', description: 'ZIP の中のフォルダ分け' },
    ],
    build: (label, p) => ({ type: 'export', label, params: normalizeExportParams({ ...DEFAULT_EXPORT_PARAMS, ...p }), status: 'idle' }),
  },
  {
    type: 'videoGen', rfType: 'videoGenerationNode', label: 'Video Generation', height: 620,
    description: '画像から動画（AI 段）。start に開始フレーム、end に終了フレーム（任意）、text に Text Prompt（共通の説明）。向きのある画像（role 付きの参照画像・Model の出力・Try-On の結果）を start/end につなぐと「正面 → 右側面」の回転の指示文が動きの欄に自動で入る（prompt は書かなくてよい）。多角度の動画はショットごとに Video Generation を置き、videoMerge で 1 本にする（Kling v3 Pro は同じ結合につながるショットの向きつき画像を参照一式として自動で使う）。商品動画は kling-v3-pro・3〜15 秒',
    inputs: [
      { port: 'text', handle: 'in-text', kind: 'text', label: 'プロンプト' },
      { port: 'start', handle: VIDEO_GEN_START_HANDLE, kind: 'image', label: '開始フレーム' },
      { port: 'end', handle: VIDEO_GEN_END_HANDLE, kind: 'image', label: '終了フレーム（任意）' },
      { port: 'video', handle: 'in-video', kind: 'video', label: '参照動画（動画から動画のモデルだけ）' },
      { port: 'element1', handle: 'in-element-1', kind: 'element', label: '参照一式 1（Kling v3 Pro だけ・@Element1）' },
      { port: 'element2', handle: 'in-element-2', kind: 'element', label: '参照一式 2（@Element2）' },
      { port: 'element3', handle: 'in-element-3', kind: 'element', label: '参照一式 3（@Element3）' },
    ],
    outputs: [{ port: 'video', handle: VIDEO_OUTPUT_HANDLE, kind: 'video', label: '動画' }],
    params: [
      { key: 'model', type: 'enum', enum: VIDEO_MODEL_IDS, default: PRODUCT_VIDEO_DEFAULT_MODEL, description: '動画モデル' },
      { key: 'duration', type: 'enum', enum: ['3', '4', '5', '6', '8', '10'], default: '3', description: '秒数' },
      { key: 'aspectRatio', type: 'enum', enum: ['auto', '16:9', '9:16', '1:1'], default: 'auto', description: '比率。商品動画は auto（写真の比率のまま）にする。横長・縦長を指定されたときだけ 16:9 / 9:16' },
      { key: 'prompt', type: 'string', default: '', description: '動き（日本語可）。回転の指示文が自動で入るときは補足だけ' },
      { key: 'negativePrompt', type: 'string', default: DEFAULT_NEGATIVE_PROMPT, description: '避けたいこと（日本語可）' },
    ],
    build: (label, p) => ({
      type: 'videoGen', label, model: pick(p.model, VIDEO_MODEL_IDS, PRODUCT_VIDEO_DEFAULT_MODEL), duration: pick(p.duration, ['3', '4', '5', '6', '8', '10'] as const, '3'), resolution: '1080p', aspectRatio: pick(p.aspectRatio, ['auto', '16:9', '9:16', '1:1'] as const, 'auto'),
      fps: 25, audioEnabled: false, seed: null, count: 1, status: 'idle', progress: '', videoUrl: null, fileName: null, error: null, requestId: null, requestEndpoint: null, activeDisplayNodeId: null,
      params: { prompt: str(p.prompt), negativePrompt: str(p.negativePrompt, DEFAULT_NEGATIVE_PROMPT) },   // 回転の指示文は compile が欄に入れてから autoTurn: false にする（トグル廃止・2026-11-01）
    }),
  },
  {
    type: 'klingElement', rfType: 'klingElementNode', label: 'Kling Element', height: 420,
    description: 'Kling の参照一式。同じ服・人物を正面（frontal）と別の角度（ref1〜ref3・1 枚以上）から写した写真をまとめ、Kling v3 Pro の Video Generation の element1 につなぐ。動画の途中で見える面の形や柄が崩れにくくなる。複数のショットに同じ一式をつないでよい',
    inputs: [
      { port: 'frontal', handle: 'in-image-frontal', kind: 'image', label: '正面' },
      { port: 'ref1', handle: 'in-image-ref1', kind: 'image', label: '別角度 1' },
      { port: 'ref2', handle: 'in-image-ref2', kind: 'image', label: '別角度 2' },
      { port: 'ref3', handle: 'in-image-ref3', kind: 'image', label: '別角度 3' },
    ],
    outputs: [{ port: 'element', handle: 'out-element-element', kind: 'element', label: '参照一式' }],
    params: [],
    build: (label) => ({ type: 'klingElement', label, params: {}, status: 'idle' }),
  },
  {
    type: 'videoMerge', rfType: 'videoMergeNode', label: 'Video Merge', height: 320,
    description: '動画を順に 1 本に結合（video に複数つなぐ・つないだ順）。一括処理では SKU ごとに結合（AI 段には数えない）',
    inputs: [{ port: 'video', handle: 'in-video-', kind: 'video', label: '動画（順）', multi: { kind: 'slot1', max: VIDEO_MERGE_MAX_INPUTS } }],
    outputs: [{ port: 'video', handle: VIDEO_OUTPUT_HANDLE, kind: 'video', label: '結合した動画' }],
    params: [],
    build: (label) => ({ type: 'videoMerge', label, params: {}, status: 'idle', videoUrl: null }),
  },
  {
    type: 'tryOn', rfType: 'tryOnNode', label: 'Try-On', height: 520,
    description: '試着（AI 段）。garment に服の画像（写真・切り抜き・向きつきの参照画像）、model にモデル画像（Model ノードの同じ向きの出力を必ずつなぐ。モデルの中身はユーザーが後で選ぶ）。role に向きの予定を入れる。出力は着用画像で、Video Generation の start/end にもつなげる（向きが引き継がれる）',
    inputs: [{ port: 'model', handle: TRY_ON_MODEL_HANDLE, kind: 'image', label: 'モデル画像（Model ノードの向きの出力）' }, { port: 'garment', handle: TRY_ON_GARMENT_HANDLE, kind: 'image', label: '服の画像', acceptsCutout: true }],
    outputs: [{ port: 'image', handle: TRY_ON_OUTPUT_HANDLE, kind: 'image', label: '着用画像' }],
    params: [
      { key: 'role', type: 'enum', enum: ['front', 'right', 'left', 'back'], default: 'front', description: '向きの予定（服の写真と同じ向き）' },
      { key: 'resolution', type: 'enum', enum: TRY_ON_RESOLUTIONS, default: DEFAULT_TRY_ON_PARAMS.resolution, description: '解像度' },
      { key: 'note', type: 'string', default: '', description: '服の説明・補足（任意・日本語可）' },
    ],
    build: (label, p) => ({ type: 'tryOn', label, params: normalizeTryOnParams({ ...DEFAULT_TRY_ON_PARAMS, ...p }), status: 'idle', model: null, output: null }),
  },
  {
    type: 'batchResults', rfType: 'batchResultsNode', label: 'Batch Results', height: 300,
    description: '一括処理の結果をこのキャンバスで見る欄（任意・ポート無し）',
    inputs: [],
    outputs: [],
    params: [],
    build: (label) => ({ type: 'batchResults', label, params: {}, status: 'idle' }),
  },
]

export const catalogNode = (type: string): CatalogNode | undefined => NODE_CATALOG.find((n) => n.type === type)

/** ポートの型の相性（canvasStore.isCompatibleFor と同じ規則）: 同じ種類どうし。cutout → image は Image Generation と Try-On の服入力だけ */
export function portsCompatible(src: PortType, dst: CatalogPort): boolean {
  if (src === dst.kind) return true
  if (src === 'cutout' && dst.kind === 'image') return !!dst.acceptsCutout
  // 動画の出力は画像の入力につながない（キャンバスと同じ・2026-11-02 メモ 41b）
  return false
}

/** 複数つなげる入力の n 番目（0 始まり）のハンドル id */
export function multiHandle(port: CatalogPort, index: number): string {
  if (!port.multi) return port.handle
  if (port.multi.kind === 'slot0') return `${port.handle}${index}`
  if (port.multi.kind === 'slot1') return `${port.handle}${index + 1}`
  return index === 0 ? port.handle : `${port.handle}-${index + 1}`   // imageGenRef: in-image, in-image-2, …
}

export const isCutRoleId = (r: unknown): r is CutRole => typeof r === 'string' && CUT_ROLES.some((x) => x.id === r)
