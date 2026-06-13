import { supabase } from '../supabase'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useAuthStore } from '../../stores/authStore'
import { useTeamStore } from '../../stores/teamStore'
import { getMyTeamContext } from './teams'
import type { Database } from '../../types/database'

/**
 * 生成前のクォータ事前チェック（UX用の表示・早期ブロック）。
 * 月次・チーム合計で判定。実際の強制は fal proxy がサーバー側で行う（クライアントは信用されない）。
 * 最新の当月消費を取得するため、毎回チームコンテキストを取り直す。
 * 未所属（運営未登録）の場合は生成不可（allowed=false）。
 */
export async function checkQuota(type: 'image' | 'video'): Promise<{ allowed: boolean; used: number; limit: number }> {
  const ctx = await getMyTeamContext()
  // 取得結果を teamStore にも反映（表示の鮮度を保つ）
  useTeamStore.setState({ context: ctx })
  if (!ctx) return { allowed: false, used: 0, limit: 0 }

  const used = type === 'image' ? ctx.usedImage : ctx.usedVideo
  const limit = type === 'image' ? ctx.quotaImageMonthly : ctx.quotaVideoMonthly
  return { allowed: used < limit, used, limit }
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
}): Promise<string | null> {
  const workflowId = useWorkflowStore.getState().currentWorkflowId
  if (!workflowId) return null

  const userId = useAuthStore.getState().user?.id ?? null
  const teamId = useTeamStore.getState().context?.teamId ?? null

  try {
    const row = await createGeneration({
      workflow_id: workflowId,
      node_id: params.nodeId,
      node_type: params.nodeType,
      provider: params.provider,
      status: params.status,
      output_url: params.outputUrl ?? null,
      error_message: params.errorMessage ?? null,
      input_params: { model: params.model, ...params.inputParams },
      user_id: userId,
      team_id: teamId,
    })
    return row.id
  } catch (err) {
    console.warn('[saveGeneration] DB書き込み失敗:', err)
    return null
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

/**
 * 履歴削除エンドポイントを呼ぶ（DB行 + Storage ファイルをサーバー側 service role で削除）。
 * - ローカル開発（VITE_FAL_KEY あり）: Vite Dev Server ミドルウェア /dev-proxy/delete-generation
 * - 本番: Edge Function /api/storage/delete-generation
 */
async function callDeleteEndpoint(body: { generationId?: string; workflowId?: string }): Promise<number> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not authenticated')

  const url = import.meta.env.VITE_FAL_KEY
    ? '/dev-proxy/delete-generation'
    : '/api/storage/delete-generation'

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `Delete failed (${res.status})`)
  }
  const data = await res.json() as { deleted: number }
  return data.deleted
}

/** 生成1件を削除する（DB行 + Storage）。クォータ消費は戻さない。 */
export async function deleteGeneration(generationId: string): Promise<void> {
  await callDeleteEndpoint({ generationId })
}

/** ワークフロー配下の全生成物（DB行 + Storage）を削除する。ワークフロー本体の削除前に呼ぶ。 */
export async function deleteGenerationsByWorkflow(workflowId: string): Promise<number> {
  return callDeleteEndpoint({ workflowId })
}
