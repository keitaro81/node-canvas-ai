// ライブラリのモデル（人物）登録（2026-10-24）: 役割ごとのカット（ライブラリの素材）に名前を付けてまとめ、商品動画 App へ一度に入れる。
// 素材と同じく個人が基本・visibility 'team' でチーム共有。モデルが参照する素材はピン留めして自動削除から外す
import { supabase } from '../supabase'
import { resolveTeamId } from '../cutout/store'
import { CUT_ROLES, type CutRole } from '../video/productVideo'
import { LIBRARY_COLUMNS, type LibraryItem, type LibraryVisibility } from './library'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any

export type ModelCuts = Partial<Record<CutRole, string>>   // role → library_item id
export interface LibraryModel {
  id: string
  user_id: string
  team_id: string
  visibility: LibraryVisibility
  name: string
  note: string | null
  cuts: ModelCuts
  created_at: string
  updated_at: string
}
const MODEL_COLUMNS = 'id, user_id, team_id, visibility, name, note, cuts, created_at, updated_at'

const normalizeCuts = (raw: unknown): ModelCuts => {
  const out: ModelCuts = {}
  if (raw && typeof raw === 'object') for (const r of CUT_ROLES) { const v = (raw as Record<string, unknown>)[r.id]; if (typeof v === 'string' && v) out[r.id] = v }
  return out
}
const normalize = (row: Record<string, unknown>): LibraryModel => ({ ...(row as unknown as LibraryModel), cuts: normalizeCuts(row.cuts) })

export async function listLibraryModels(): Promise<LibraryModel[]> {
  const { data, error } = await sb.from('library_models').select(MODEL_COLUMNS).order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(normalize)
}

export async function createLibraryModel(input: { name: string; note?: string | null; cuts: ModelCuts; visibility?: LibraryVisibility }): Promise<LibraryModel> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('ログインが必要です')
  const teamId = await resolveTeamId()
  const { data, error } = await sb.from('library_models').insert({ user_id: user.id, team_id: teamId, visibility: input.visibility ?? 'private', name: input.name.trim(), note: input.note?.trim() || null, cuts: input.cuts }).select(MODEL_COLUMNS).single()
  if (error) throw new Error(error.message)
  return normalize(data)
}

export async function updateLibraryModel(id: string, patch: Partial<{ name: string; note: string | null; cuts: ModelCuts; visibility: LibraryVisibility }>): Promise<LibraryModel> {
  const { data, error } = await sb.from('library_models').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(MODEL_COLUMNS).single()
  if (error) throw new Error(error.message)
  return normalize(data)
}

export async function deleteLibraryModel(id: string): Promise<void> {
  const { error } = await sb.from('library_models').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** モデルが参照する素材をまとめて取得（見えないものは RLS で落ちる） */
export async function fetchLibraryItemsByIds(ids: string[]): Promise<LibraryItem[]> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return []
  const { data, error } = await sb.from('library_items').select(LIBRARY_COLUMNS).in('id', uniq)
  if (error) throw new Error(error.message)
  return (data ?? []) as LibraryItem[]
}

/** モデルが参照する素材をピン留め（自分の素材だけ更新される。他人のものは RLS で 0 行） */
export async function pinLibraryItems(ids: string[]): Promise<void> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return
  await sb.from('library_items').update({ pinned: true }).in('id', uniq).eq('pinned', false)
}

/** モデルをチームに共有したら、その写真もチームに共有する（メンバーが App で使えるように。自分の素材だけ更新される） */
export async function shareLibraryItemsWithTeam(ids: string[]): Promise<void> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return
  await sb.from('library_items').update({ visibility: 'team' }).in('id', uniq).eq('visibility', 'private')
}

export const modelItemIds = (m: Pick<LibraryModel, 'cuts'>): string[] => Object.values(m.cuts).filter((v): v is string => !!v)
export const modelsUsingItem = (models: LibraryModel[], itemId: string): LibraryModel[] => models.filter((m) => modelItemIds(m).includes(itemId))
