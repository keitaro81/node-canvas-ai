import { supabase } from '../supabase'
import type { Database } from '../../types/database'

type ProjectRow = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']

export type { ProjectRow }

export async function getProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as any
}

export async function getProject(id: string): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any
}

export async function createProject(data: ProjectInsert): Promise<ProjectRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('projects') as any
  const { data: project, error } = await table
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return project as ProjectRow
}

export async function updateProject(id: string, data: ProjectUpdate): Promise<ProjectRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = supabase.from('projects') as any
  const { data: project, error } = await table
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return project as ProjectRow
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
  if (error) throw error
}
