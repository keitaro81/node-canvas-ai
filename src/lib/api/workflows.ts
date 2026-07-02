import { supabase } from '../supabase'
import { toCanonicalRef } from './storage'
import { signWorkflowThumbnails } from './signMedia'
import type { Database } from '../../types/database'

type WorkflowRow = Database['public']['Tables']['workflows']['Row']
type WorkflowInsert = Database['public']['Tables']['workflows']['Insert']
type WorkflowUpdate = Database['public']['Tables']['workflows']['Update']

export type { WorkflowRow }

export async function getWorkflows(projectId: string): Promise<WorkflowRow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  // 非公開バケット化: カード表示用に thumbnail_url を署名URL化（読込口）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return signWorkflowThumbnails((data ?? []) as any)
}

export async function getWorkflow(id: string): Promise<WorkflowRow> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any
}

export async function createWorkflow(data: WorkflowInsert): Promise<WorkflowRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('workflows') as any
  const { data: workflow, error } = await table
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return workflow as WorkflowRow
}

export async function updateWorkflow(id: string, data: WorkflowUpdate): Promise<WorkflowRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('workflows') as any
  const { data: workflow, error } = await table
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return workflow as WorkflowRow
}

export async function deleteWorkflow(id: string): Promise<void> {
  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function getPublicWorkflows(): Promise<WorkflowRow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .eq('is_public' as any, true)
    .order('updated_at', { ascending: false })
  if (error) throw error
  // 非公開バケット化: コミュニティカード用に thumbnail_url を署名URL化（読込口）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return signWorkflowThumbnails((data ?? []) as any)
}

// L2: ワークフロー可視性（private=本人のみ / team=同チーム共有 / public=コミュニティ）
export type WorkflowVisibility = 'private' | 'team' | 'public'

/** 可視性を設定。is_public も後方互換で同期（getPublicWorkflows 等が動き続ける）。 */
export async function setWorkflowVisibility(id: string, visibility: WorkflowVisibility): Promise<void> {
  const patch: Record<string, unknown> = {
    visibility,
    is_public: visibility === 'public',
    updated_at: new Date().toISOString(),
  }
  // 'team' 共有＝「今の所属チーム」への共有。workflows.team_id は作成時トリガでしか設定されないため、
  // チーム移動後に古い WF が旧（空になった）チームへ共有されて誰にも見えない事故を防ぐべく、共有時点の所属で揃える。
  // （RLS: team_members SELECT は自チーム行のみ＝どの行でも team_id は自分のチーム。1人1チーム enforce 済み）
  if (visibility === 'team') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: m } = await (supabase.from('team_members') as any).select('team_id').limit(1).maybeSingle()
    if (m?.team_id) patch.team_id = m.team_id
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('workflows') as any
  const { error } = await table.update(patch).eq('id', id)
  if (error) throw error
}

/** チーム共有ワークフロー（visibility='team'・RLS で自チームのみ）を取得（サムネ署名つき）。 */
export async function getTeamWorkflows(): Promise<WorkflowRow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .eq('visibility' as any, 'team')
    .order('updated_at', { ascending: false })
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return signWorkflowThumbnails((data ?? []) as any)
}

export async function updateWorkflowThumbnail(id: string, thumbnailUrl: string): Promise<void> {
  // 署名URLを保存しないよう canonical へ正規化（書込口）
  const canonical = toCanonicalRef(thumbnailUrl) ?? thumbnailUrl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('workflows') as any
  const { error } = await table
    .update({ thumbnail_url: canonical, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * canvas_data 内の特定ノードの data フィールドを直接 DB に書き込む。
 * 生成が完了した時点でユーザーが別プロジェクトに移動していても、
 * 生成開始時に捕捉した workflowId を使って正しいワークフローを更新できる。
 * fire-and-forget 用途を想定（呼び出し側で catch すること）。
 */
export async function patchWorkflowNodeOutput(
  workflowId: string,
  nodeId: string,
  dataUpdate: Record<string, unknown>
): Promise<void> {
  const workflow = await getWorkflow(workflowId)
  const canvasData = workflow.canvas_data as {
    nodes: Array<{ id: string; data: Record<string, unknown> }>
  } | null
  if (!canvasData?.nodes) return

  // 署名URLを保存しないよう、URL文字列フィールドを canonical へ正規化（書込口）
  const canonicalUpdate: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(dataUpdate)) {
    canonicalUpdate[k] = typeof v === 'string' ? (toCanonicalRef(v) ?? v) : v
  }
  const nodes = canvasData.nodes.map((n) =>
    n.id === nodeId ? { ...n, data: { ...n.data, ...canonicalUpdate } } : n
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('workflows') as any
  const { error } = await table
    .update({ canvas_data: { ...canvasData, nodes }, updated_at: new Date().toISOString() })
    .eq('id', workflowId)
  if (error) throw error
}

export async function toggleWorkflowPublic(id: string, isPublic: boolean): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('workflows') as any
  const { error } = await table
    .update({ is_public: isPublic, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
