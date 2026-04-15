import { supabase } from '../supabase'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useAuthStore } from '../../stores/authStore'
import type { Database } from '../../types/database'

export const QUOTA_IMAGE = 100
export const QUOTA_VIDEO = 7

export async function getUserQuotaUsage(): Promise<{ images: number; videos: number }> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) return { images: 0, videos: 0 }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('generations') as any)
    .select('node_type')
    .eq('user_id', userId)
    .eq('status', 'completed')

  if (error) return { images: 0, videos: 0 }

  const rows = (data ?? []) as { node_type: string | null }[]
  return {
    images: rows.filter((r) => r.node_type === 'image-generation').length,
    videos: rows.filter((r) => r.node_type === 'video-generation').length,
  }
}

export async function checkQuota(type: 'image' | 'video'): Promise<{ allowed: boolean; used: number; limit: number }> {
  // user_metadata はログイン時のJWTにキャッシュされるため、
  // サーバーから最新情報を取得して設定変更を即時反映させる
  const { data: { user: freshUser } } = await supabase.auth.getUser()
  const meta = freshUser?.user_metadata ?? {}
  const limitImage = typeof meta.quota_image === 'number' ? meta.quota_image : QUOTA_IMAGE
  const limitVideo = typeof meta.quota_video === 'number' ? meta.quota_video : QUOTA_VIDEO

  const { images, videos } = await getUserQuotaUsage()
  if (type === 'image') return { allowed: images < limitImage, used: images, limit: limitImage }
  return { allowed: videos < limitVideo, used: videos, limit: limitVideo }
}

type GenerationRow = Database['public']['Tables']['generations']['Row']
type GenerationInsert = Database['public']['Tables']['generations']['Insert']
type GenerationUpdate = Database['public']['Tables']['generations']['Update']

/**
 * 生成完了時に履歴をDBに書き込む fire-and-forget ラッパー。
 * DB失敗は無視し、生成フローを止めない。
 */
export async function saveGeneration(params: {
  nodeId: string
  nodeType: string
  provider: string
  model?: string
  status: 'completed' | 'failed'
  outputUrl?: string
  errorMessage?: string
  inputParams?: Record<string, unknown>
}): Promise<void> {
  const workflowId = useWorkflowStore.getState().currentWorkflowId
  if (!workflowId) return

  const userId = useAuthStore.getState().user?.id ?? null

  try {
    await createGeneration({
      workflow_id: workflowId,
      node_id: params.nodeId,
      node_type: params.nodeType,
      provider: params.provider,
      status: params.status,
      output_url: params.outputUrl ?? null,
      error_message: params.errorMessage ?? null,
      input_params: { model: params.model, ...params.inputParams },
      user_id: userId,
    })
  } catch (err) {
    console.warn('[saveGeneration] DB書き込み失敗:', err)
  }
}

export async function createGeneration(data: GenerationInsert): Promise<GenerationRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: generation, error } = await (supabase as any)
    .from('generations')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return generation
}

export async function updateGeneration(id: string, data: GenerationUpdate): Promise<GenerationRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: generation, error } = await (supabase as any)
    .from('generations')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return generation
}

export async function getGenerations(workflowId: string): Promise<GenerationRow[]> {
  const { data, error } = await supabase
    .from('generations')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** ワークフローIDごとに最新の生成物URLを1件取得する */
export async function getLatestGenerationUrlsByWorkflow(
  workflowIds: string[]
): Promise<Record<string, string>> {
  if (!workflowIds.length) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('generations') as any)
    .select('workflow_id, output_url')
    .in('workflow_id', workflowIds)
    .eq('status', 'completed')
    .not('output_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(workflowIds.length * 10)
  if (error) throw error
  const map: Record<string, string> = {}
  for (const g of (data ?? []) as { workflow_id: string; output_url: string }[]) {
    if (!map[g.workflow_id]) map[g.workflow_id] = g.output_url
  }
  return map
}

export type GenerationWithWorkflow = GenerationRow & { workflow_name: string }

export async function getMyGenerations(): Promise<GenerationWithWorkflow[]> {
  // Step 1: 自分のプロジェクト一覧
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: projects, error: projError } = await (supabase.from('projects') as any).select('id')
  if (projError) throw projError
  if (!projects?.length) return []

  const projectIds = (projects as { id: string }[]).map((p) => p.id)

  // Step 2: 対象ワークフロー一覧（名前付き）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: workflows, error: wfError } = await (supabase.from('workflows') as any)
    .select('id, name')
    .in('project_id', projectIds)
  if (wfError) throw wfError
  if (!workflows?.length) return []

  const typedWorkflows = workflows as { id: string; name: string }[]
  const workflowMap: Record<string, string> = {}
  for (const w of typedWorkflows) workflowMap[w.id] = w.name
  const workflowIds = typedWorkflows.map((w) => w.id)

  // Step 3: 完了済み生成物（output_url あり）を時系列降順
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: generations, error: genError } = await (supabase.from('generations') as any)
    .select('*')
    .in('workflow_id', workflowIds)
    .eq('status', 'completed')
    .not('output_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (genError) throw genError

  return ((generations ?? []) as GenerationRow[]).map((g) => ({
    ...g,
    workflow_name: workflowMap[g.workflow_id] ?? 'Unknown',
  }))
}
