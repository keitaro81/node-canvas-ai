export type PortType = 'text' | 'image' | 'video' | 'style' | 'list' | 'cutout'

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
}

export interface ListNodeData {
  label: string
  slotCount: number
  /** 'unset' = 未接続で両方受け付け、最初の接続で自動確定 */
  mode: 'image' | 'text' | 'unset'
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
  bbox: CutoutBBox | null      // しきい値適用後の外接矩形（全透明なら null）
  engine: CutoutEngine
  params: CutoutParams         // 実行/再適用時のパラメータのスナップショット
  createdAt: string
}
