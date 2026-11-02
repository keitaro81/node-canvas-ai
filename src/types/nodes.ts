export type PortType = 'text' | 'image' | 'video' | 'style' | 'list' | 'cutout' | 'item' | 'cuts' | 'element'   // element = Kling の参照一式（Kling Element → Video Generation・2026-11-02）

import type { CutRole } from '../lib/video/productVideo'

export type NodeType =
  | 'text'
  | 'image'
  | 'video'
  | 'utility'
  | 'textPrompt'
  | 'imageGen'
  | 'imageDisplay'
  | 'videoGen'
  | 'videoDisplay'
  | 'referenceImage'
  | 'referenceVideo'
  | 'note'
  | 'promptEnhancer'
  | 'group'
  | 'list'
  | 'cameraList'
  | 'removeBackground'
  | 'productLayout'
  | 'batchInput'
  | 'export'
  | 'batchResults'
  | 'videoMerge'
  | 'tryOn'
  | 'libraryModel'
  | 'klingElement'

// Capsule機能: フィールド単位の公開フラグ
export type CapsuleVisibility = 'hidden' | 'visible' | 'editable'

export interface CapsuleFieldDef {
  id: string
  capsuleVisibility: CapsuleVisibility
  capsuleLabel?: string   // Capsule表示用ラベル（省略時はノード内ラベルを使用）
  capsuleOrder?: number   // Capsule内での表示順
}

// グループノードのデータ
export interface GroupNodeData {
  label: string
  capsuleEnabled: boolean   // このグループをCapsuleビューで表示するか
}

export type NodeStatus = 'idle' | 'generating' | 'done' | 'error'

export interface NodeData {
  type: NodeType
  label: string
  params: Record<string, unknown>
  status: NodeStatus
  output?: unknown
  [key: string]: unknown
}

export interface PortDef {
  id: string
  portType: PortType
  label?: string
}

export const PORT_COLORS: Record<PortType, string> = {
  text:  '#6366F1',
  image: '#8B5CF6',
  video: '#EC4899',
  style: '#6B7280',
  list:  '#8B5CF6',
  cutout: '#14B8A6',
  item:   '#6B7280',
  cuts:   '#F472B6',
  element: '#F472B6',   // 参照一式（Video Generation の入力・Kling Element の出力とそろえる。動画の #EC4899 と見分ける）
}

export const NODE_ACCENT_COLORS: Record<NodeType, string> = {
  group:          '#3F3F46',
  text:           '#6366F1',
  image:          '#8B5CF6',
  video:          '#EC4899',
  utility:        '#6B7280',
  textPrompt:     '#6366F1',
  imageGen:       '#8B5CF6',
  imageDisplay:   '#8B5CF6',
  videoGen:       '#EC4899',
  videoDisplay:   '#EC4899',
  referenceImage:  '#8B5CF6',
  referenceVideo:  '#EC4899',
  note:            '#F59E0B',
  promptEnhancer:  '#6366F1',
  list:            '#8B5CF6',
  cameraList:      '#8B5CF6',
  removeBackground: '#14B8A6',
  productLayout:   '#14B8A6',
  batchInput:      '#14B8A6',
  export:          '#14B8A6',
  batchResults:    '#14B8A6',
  videoMerge:      '#EC4899',
  tryOn:           '#8B5CF6',
  libraryModel:    '#8B5CF6',
  klingElement:    '#EC4899',
}

// ===== ビデオノード関連の型 =====

export interface VideoGenerationNodeData {
  label: string
  model: string
  duration: string
  resolution: string
  aspectRatio: string
  fps: number
  audioEnabled: boolean
  seed: number | null
  status: 'idle' | 'queued' | 'processing' | 'completed' | 'failed'
  progress: string
  videoUrl: string | null
  fileName: string | null
  error: string | null
  count: number
  requestId: string | null        // fal.ai queue request ID for recovery on reload
  requestEndpoint: string | null  // fal.ai endpoint used (required for recovery)
  activeDisplayNodeId: string | null  // DisplayNode being written to (for recovery)
  capsuleFields?: Record<string, CapsuleFieldDef>
  /** 参照カット（in-image-cuts）のうち「正面」にする接続元ノード id。未指定なら先頭（Kling 3.0 elements） */
  cutsFrontalNodeId?: string | null
  /** マルチショット（Kling 3.0 multi_prompt）。空なら通常の 1 プロンプト生成 */
  shots?: Array<{ prompt: string; duration: number }>
  /** 商品動画向けの設定（2026-10-31・設計 §4.2）: 動き（日本語可・生成時に英訳）/ 避けたいこと（Kling 系）。autoTurn は旧互換（トグル時代の自動付与。新しいノードは false で、回転の定型文は動きの欄に入れる・2026-11-01） */
  params?: { prompt?: string; negativePrompt?: string; autoTurn?: boolean }
}

export interface ListNodeData {
  label: string
  slotCount: number
  /** 'unset' = 未接続でどれも受け付け、最初の接続で自動確定。video は 2026-11-02 メモ 40（Video Generation のリストで参照動画に使う） */
  mode: 'image' | 'text' | 'video' | 'unset'
}

export interface CameraListNodeData {
  label: string
  selectedPresets: string[]
  customAngles: string[]
}

export interface ReferenceImageNodeData {
  label: string
  imageUrl: string | null
  uploadedImagePreview: string | null
  maskUrl?: string | null
  maskPreviewDataUrl?: string | null
  /** 旧: 向き（2026-11-02 メモ 42 で廃止。読まない・書かない。古いワークフローの値は photoHint が無いときの表示にだけ使う） */
  role?: CutRole | null
  /** どの写真を入れるかの案内（テンプレートが付ける・表示だけ。見出し「Reference Image（正面）」と空の枠の文に出す） */
  photoHint?: string | null
}

/** Kling の参照一式（同じ服・人物を正面と別の角度から写した写真のまとまり）。入力 = 正面 1 + 別角度 1〜3（ポートでつなぐだけ）、出力 = 参照一式 */
export interface KlingElementNodeData {
  type: 'klingElement'
  label: string
  params: Record<string, unknown>
  status: NodeStatus
}

export interface ReferenceVideoNodeData {
  label: string
  videoUrl: string | null
  uploadedVideoPreview: string | null
}

export interface VideoDisplayNodeData {
  label: string
  videoUrl: string | null
  fileName: string | null
  autoPlay: boolean
  loop: boolean
  muted: boolean
  status?: 'idle' | 'queued' | 'processing' | 'completed' | 'failed'
  progress?: string
  error?: string | null
}

// ===== 撮影後工程（Post-Production）: 背景切り抜き =====

export type CutoutEngine = 'bria' | 'birefnet'
export type CutoutPreviewBg = 'white' | 'gray' | 'checker'

/** RemoveBackgroundNode のパラメータ。全て保存可能な設定値（原則3）として data.params に保存する。 */
export interface CutoutParams {
  engine: CutoutEngine
  birefnetModel: string        // BiRefNet 選択時のみ有効（fal の model enum 文字列）
  birefnetResolution: string   // '1024x1024' | '2048x2048' | '2304x2304'（2304 は Dynamic のみ）
  alphaThreshold: number       // 0〜255。これ以下のアルファ値を 0 として扱う
  featherPx: number            // 縁のぼかし幅（px）
  previewBg: CutoutPreviewBg   // ノード上のプレビュー背景
}

export interface CutoutBBox { x: number; y: number; w: number; h: number }

/**
 * 切り抜き = 元画像とマスクの参照の組（透過画像は実体化しない。仕様 2 章）。
 * - 元画像の表示/入力用 URL は上流ノードから都度取る。ここには照合用の canonical 参照だけ持つ
 * - maskPath は fal の結果から作った「生マスク」（しきい値適用前・元解像度・輝度 PNG）。
 *   しきい値/ぼかしは利用時にブラウザで適用する（fal を呼び直さずに再調整できる）
 * - previewPath は表示用の透過サムネイル（長辺 400px。仕様 4-9）
 */
export interface CutoutRef {
  sourceRef: string
  width: number
  height: number
  maskPath: string             // batch バケット内 <team_id>/interactive/<nodeId>/<ts>-mask.png
  previewPath: string          // batch バケット内 <team_id>/interactive/<nodeId>/<ts>-preview.png
  cutoutPath?: string | null   // 透過の切り抜き画像 <ts>-cutout.png（後段に Image Generation があるときだけ保存。合成の入力）
  bbox: CutoutBBox | null      // しきい値適用後の外接矩形（全透明なら null）
  engine: CutoutEngine
  params: CutoutParams         // 実行/再適用時のパラメータのスナップショット
  createdAt: string
}

// ===== 撮影後工程: 商品レイアウト（ProductLayoutNode） =====

export type LayoutMarginUnit = 'percent' | 'px'
export type LayoutAlignH = 'left' | 'center' | 'right'
export type LayoutAlignV = 'top' | 'center' | 'bottom'
export type LayoutBackgroundKind = 'color' | 'image' | 'transparent'
export type LayoutBackgroundFit = 'cover' | 'contain'
export type LayoutShadowKind = 'none' | 'drop' | 'contact'

/** ProductLayoutNode のパラメータ（仕様 3-3 の表。全て保存可能な設定値＝原則3）。 */
export interface LayoutParams {
  variantName: string              // 書き出し時のファイル名/フォルダに使う（既定 ec_white）
  width: number                    // 出力サイズ px
  height: number
  maxScalePercent: number          // 拡大の上限（%）。既定 100 = 拡大しない（仕様 3-3）。顧客都合で 150〜200 まで緩められる
  marginUnit: LayoutMarginUnit     // 余白の単位
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  alignH: LayoutAlignH
  alignV: LayoutAlignV
  backgroundKind: LayoutBackgroundKind
  backgroundColor: string          // 単色のとき（#RRGGBB）
  backgroundFit: LayoutBackgroundFit // 背景画像のとき
  shadowKind: LayoutShadowKind
  shadowOpacity: number            // 0〜1
  shadowBlur: number               // px（出力座標）
  shadowOffsetX: number            // px（ドロップシャドウ）
  shadowOffsetY: number
  contactWidthRatio: number        // 接地影の幅 = 商品幅 × 比
  contactHeightRatio: number       // 接地影の高さ = 商品高さ × 比
}

/** レイアウト出力の記録（data.layout）。表示用 URL は data.output（canonical URL 文字列）に持つ。 */
export interface LayoutOutputRef {
  path: string                     // batch バケット内 <team_id>/interactive/<nodeId>/<layoutHash>.png
  width: number
  height: number
  layoutHash: string               // レイアウトの識別値（同じ内容の出力は作り直さない。仕様 4-10）
  warnings: string[]
  sourceRef: string                // 使った元画像の canonical 参照
  maskPath: string                 // 使ったマスク
  createdAt: string
}

// 一括実行時のノードの実行スコープ（仕様 4-2）: アイテムごと（既定）/ ジョブごと（1 回だけ実行し全アイテムで共有。背景生成向け）
export type ExecutionScope = 'item' | 'job'

// ===== 撮影後工程: 一括入力（BatchInputNode）と書き出し（ExportNode） =====

export interface BatchInputParams {
  skuPattern: string               // SKU 抽出の正規表現（最初の一致 / 第 1 グループ）。既定: 先頭から最初のアンダースコアまで
  sortOrder: 'filename'            // 並び順（今回はファイル名順のみ）
}

export type BatchItemStatus = 'pending' | 'uploading' | 'ready' | 'error'

/** BatchInputNode が保持するアイテム（画像 1 枚）。File 本体は保存しない。 */
/** Video Merge ノード（2026-10-31・設計 docs/specs/product-video-nodes.md §4.3）: 順序付きの動画入力（in-video-1…8）を 1 本に結合（fal ffmpeg）。一括実行では SKU ごとの結合タスク */
export interface VideoMergeNodeData {
  type: 'videoMerge'
  label: string
  params: Record<string, unknown>
  status: NodeStatus
  videoUrl: string | null          // 結合結果（canonical。表示は署名して使う）
  fileName?: string | null
  error?: string | null
  progress?: string
}

/** Try-On ノード（2026-11-01・設計 docs/specs/library-tryon.md §4.1 / §7）: モデル画像 + 服の画像 → 着用画像（Nano Banana 2 edit・試着用の既定プロンプト）。
 *  モデルはつなぐか、ノード内の「モデル」でライブラリのモデルと向きを選ぶ（配線があれば配線が優先）。結果は右に作る Image Display と、このノードの output（最新）に出す */
export interface TryOnModelRef {
  itemId: string            // library_items.id
  url: string               // 保存形式の URL（canonical。表示・生成時に署名する）
  modelId: string | null    // library_models.id
  modelName: string | null
  role: CutRole | null      // 向き（正面など）
}
export interface TryOnNodeData {
  type: 'tryOn'
  label: string
  params: { resolution?: string; note?: string }
  status: NodeStatus
  model?: TryOnModelRef | null
  output?: string | null
  progress?: string
  error?: string | null
}

/** Model ノード（2026-11-01）: ライブラリのモデルを選ぶと向きごとの出力ポート（out-image-<role>）が出る。Try-On の model 入力や Video Generation の始点・終点に。
 *  cuts は保存形式の URL（canonical）、outputs は表示・生成用の署名 URL（読み込み時に作り直す。保存しない） */
export interface LibraryModelNodeData {
  type: 'libraryModel'
  label: string
  params: Record<string, unknown>
  status: NodeStatus
  modelId: string | null
  modelName: string | null
  cuts: Partial<Record<CutRole, { itemId: string; url: string }>>
  outputs?: Record<string, string>
}

export interface BatchItem {
  id: string
  index: number                    // 並び順（1 始まり）。{index} トークンに使う
  originalName: string             // 元のファイル名（拡張子つき）
  sku: string
  path: string | null              // batch バケット内のパス（アップロード後）
  size: number
  width?: number
  height?: number
  status: BatchItemStatus
  error?: string
}

/** ExportNode に渡すアイテム情報（仕様 2 章「元のファイル名、SKU、並び順」） */
export interface BatchItemInfo {
  sku: string                      // 商品のまとまり（ファイル名から SKU の規則で取り出す）。「商品別」のフォルダ分けに使う
  original: string                 // 拡張子を除いた元ファイル名
  index: number
  name?: string                    // ファイル名の「商品名」（一括では写真の名前そのまま・2026-11-02 メモ 65）。無ければ sku
}

export type ExportFormat = 'jpeg' | 'png' | 'webp'
export type ExportZipFolders = 'variant' | 'sku' | 'none'

export interface ExportParams {
  namePattern: string              // 既定 {sku}_{variant}_{index:02}
  format: ExportFormat             // 既定 jpeg
  jpegQuality: number              // 既定 90（JPEG/WebP）
  maxFileKb: number | null         // 指定時は品質を段階的に下げて収める（下限 70）
  zip: boolean                     // 既定 true
  zipFolders: ExportZipFolders     // 既定 variant
  includeCutout: boolean           // 既定 true: 切り抜きの透過 PNG（元のサイズ）も cutout/ として書き出す
  productName: string              // 入口（Batch Input）が無い構成の {sku}（空ならワークフロー名・2026-11-01）
}

export interface ExportFileResult {
  path: string                     // ZIP 内のパス（フォルダ含む）
  bytes: number
  format: ExportFormat | 'mp4'     // 動画は mp4 のまま
  quality: number | null
  warnings: string[]
}

export interface ExportResult {
  at: string
  zipName: string | null
  files: ExportFileResult[]
  warnings: string[]
}
