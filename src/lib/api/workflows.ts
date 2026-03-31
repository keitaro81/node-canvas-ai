import { supabase } from '../supabase'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as any
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
