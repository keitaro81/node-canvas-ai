export type PortType = 'text' | 'image' | 'video' | 'style'

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
  | 'note'
  | 'imageComposite'
  | 'promptEnhancer'
  | 'group'

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
  note:            '#F59E0B',
  imageComposite:  '#8B5CF6',
  promptEnhancer:  '#6366F1',
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
  capsuleFields?: Record<string, CapsuleFieldDef>
}

export interface ReferenceImageNodeData {
  label: string
  imageUrl: string | null
  uploadedImagePreview: string | null
}

export interface VideoDisplayNodeData {
  label: string
  videoUrl: string | null
  fileName: string | null
  autoPlay: boolean
  loop: boolean
  muted: boolean
}
