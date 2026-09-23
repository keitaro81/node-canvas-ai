// 撮影後工程 一括実行（バッチ）の行型と表示メタ（migration 0011/0012 の batch_* に対応）

export type BatchJobStatus = 'uploading' | 'submitted' | 'processing' | 'completed' | 'partial_failed' | 'cancelled'
export type BatchItemDbStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type BatchReview = 'unreviewed' | 'ok' | 'ng'

export const ACTIVE_JOB_STATUSES: BatchJobStatus[] = ['uploading', 'submitted', 'processing']
export const FINISHED_JOB_STATUSES: BatchJobStatus[] = ['completed', 'partial_failed', 'cancelled']

export interface BatchJobRow {
  id: string
  team_id: string
  created_by: string | null
  name: string
  status: BatchJobStatus
  item_count: number
  task_count: number
  completed_tasks: number
  failed_tasks: number
  estimated_cost_usd: number
  actual_cost_usd: number
  created_at: string
  updated_at: string
}

/** 一覧・詳細で読む列（workflow_snapshot は大きいので読まない） */
export const JOB_COLUMNS = 'id, team_id, created_by, name, status, item_count, task_count, completed_tasks, failed_tasks, estimated_cost_usd, actual_cost_usd, created_at, updated_at'

export interface BatchItemRow {
  id: string
  job_id: string
  team_id: string
  sort_order: number
  original_filename: string
  sku: string
  source_path: string | null
  interactive_path: string | null
  width: number | null
  height: number | null
  status: BatchItemDbStatus
  review: BatchReview
  reviewed_by: string | null
  warnings: string[]
  created_at: string
  updated_at: string
}

export const ITEM_COLUMNS = 'id, job_id, team_id, sort_order, original_filename, sku, source_path, interactive_path, width, height, status, review, reviewed_by, warnings, created_at, updated_at'

export interface ReviewCounts { ok: number; ng: number; unreviewed: number }

export const JOB_STATUS_META: Record<BatchJobStatus, { label: string; color: string; bg: string; active: boolean }> = {
  uploading:      { label: '投入中',       color: '#14B8A6', bg: 'rgba(20,184,166,0.12)',  active: true },
  submitted:      { label: '投入済み',     color: '#6366F1', bg: 'rgba(99,102,241,0.12)',  active: true },
  processing:     { label: '処理中',       color: '#6366F1', bg: 'rgba(99,102,241,0.12)',  active: true },
  completed:      { label: '完了',         color: '#22C55E', bg: 'rgba(34,197,94,0.12)',   active: false },
  partial_failed: { label: '一部失敗',     color: '#F59E0B', bg: 'rgba(245,158,11,0.14)',  active: false },
  cancelled:      { label: 'キャンセル済み', color: '#71717A', bg: 'rgba(113,113,122,0.15)', active: false },
}

export const ITEM_STATUS_META: Record<BatchItemDbStatus, { label: string; color: string }> = {
  pending:    { label: '待機',     color: '#71717A' },
  processing: { label: '処理中',   color: '#6366F1' },
  ready:      { label: '準備完了', color: '#22C55E' },
  failed:     { label: '失敗',     color: '#EF4444' },
}

export const REVIEW_META: Record<BatchReview, { label: string; color: string; bg: string }> = {
  unreviewed: { label: '未確認', color: '#A1A1AA', bg: 'rgba(161,161,170,0.12)' },
  ok:         { label: 'OK',     color: '#22C55E', bg: 'rgba(34,197,94,0.14)' },
  ng:         { label: 'NG',     color: '#EF4444', bg: 'rgba(239,68,68,0.14)' },
}

// ───────────────────────── ReviewGrid（Step 7）で読む行 ─────────────────────────

export type BatchTaskStatus = 'pending' | 'submitted' | 'completed' | 'failed' | 'cancelled'

export interface BatchTaskResultMeta {
  kind?: string                    // 'mask' | 'rgba' | 'image'
  width?: number | null
  height?: number | null
  contentType?: string
  falRequestId?: string | null
}

export interface BatchTaskRow {
  id: string
  job_id: string
  item_id: string | null
  team_id: string
  node_id: string
  endpoint: string
  input: Record<string, unknown>
  status: BatchTaskStatus
  attempts: number
  error: string | null
  result_path: string | null
  result_meta: BatchTaskResultMeta | null
  submitted_at: string | null
  completed_at: string | null
}

export const TASK_COLUMNS = 'id, job_id, item_id, team_id, node_id, endpoint, input, status, attempts, error, result_path, result_meta, submitted_at, completed_at'

export type BatchOutputKind = 'full' | 'thumb'

export interface BatchOutputRow {
  id: string
  item_id: string
  team_id: string
  variant: string                  // ReviewGrid ではバリアント＝Product Layout ノード ID（'__cutout' は切り抜きプレビュー）
  layout_hash: string
  output_path: string
  executor: 'browser' | 'server'
  kind: BatchOutputKind
  created_at: string
}

export const OUTPUT_COLUMNS = 'id, item_id, team_id, variant, layout_hash, output_path, executor, kind, created_at'

/** ジョブ詳細（写しと上書き設定を含む） */
export interface BatchJobDetail extends BatchJobRow {
  workflow_snapshot: { nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>; edges?: Array<{ source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }> }
  layout_overrides: Record<string, unknown>
  workflow_id: string | null      // 投入元ワークフロー（0014）。バリアントはこのワークフローの現在のノードから作る
}

export const JOB_DETAIL_COLUMNS = `${JOB_COLUMNS}, workflow_snapshot, layout_overrides, workflow_id`
