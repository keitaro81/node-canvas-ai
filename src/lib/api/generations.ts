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
