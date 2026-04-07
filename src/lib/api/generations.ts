import { supabase } from '../supabase'
import { useWorkflowStore } from '../../stores/workflowStore'
import type { Database } from '../../types/database'

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
