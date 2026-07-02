import { supabase } from '../supabase'

// チーム管理 API クライアント。書込（invite/join/leave/remove/role）と一覧取得は
// サーバー（/api/team/manage, dev は /dev-proxy/team-manage）経由。設計: docs/specs/team-management-mvp.md

export interface TeamMember {
  userId: string
  email: string | null
  role: 'owner' | 'member'
  isMe: boolean
}

export interface TeamInfo {
  teamId: string
  teamName: string | null
  myRole: 'owner' | 'member'
  quota: { image: number; video: number } | null
  members: TeamMember[]
  invite: { token: string; expiresAt: string } | null
}

interface ManageBody {
  action: 'invite' | 'join' | 'preview' | 'leave' | 'remove' | 'role' | 'list'
  token?: string
  userId?: string
  role?: 'owner' | 'member'
}

async function manage(body: ManageBody): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, status: 401, data: { error: 'Not authenticated' } }
  const endpoint = import.meta.env.VITE_FAL_KEY ? '/dev-proxy/team-manage' : '/api/team/manage'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    // 空応答は無視
  }
  return { ok: res.ok, status: res.status, data }
}

function errOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === 'string' ? data.error : fallback
}

/** チーム情報＋メンバー一覧（email 付き・owner なら現在の招待リンク含む）。 */
export async function getTeamInfo(): Promise<TeamInfo> {
  const r = await manage({ action: 'list' })
  if (!r.ok) throw new Error(errOf(r.data, 'チーム情報の取得に失敗しました'))
  return r.data as unknown as TeamInfo
}

/** owner: 招待リンクを発行（旧リンクは失効）。 */
export async function createInvite(): Promise<{ token: string; expiresAt: string }> {
  const r = await manage({ action: 'invite' })
  if (!r.ok) throw new Error(errOf(r.data, '招待リンクの発行に失敗しました'))
  return { token: r.data.token as string, expiresAt: r.data.expiresAt as string }
}

/** 招待リンクのトークンでチームに参加。 */
export async function joinTeam(token: string): Promise<{ teamId: string; teamName: string | null }> {
  const r = await manage({ action: 'join', token })
  if (!r.ok) throw new Error(errOf(r.data, '参加に失敗しました'))
  return { teamId: r.data.teamId as string, teamName: (r.data.teamName as string) ?? null }
}

/** 参加前の確認用: 招待トークンの有効性を検証しチーム名を返す（書込なし）。 */
export async function previewInvite(token: string): Promise<{ teamName: string | null }> {
  const r = await manage({ action: 'preview', token })
  if (!r.ok) throw new Error(errOf(r.data, '招待リンクを確認できませんでした'))
  return { teamName: (r.data.teamName as string) ?? null }
}

/** チームを離脱（新個人チームへ戻る）。 */
export async function leaveTeam(): Promise<void> {
  const r = await manage({ action: 'leave' })
  if (!r.ok) throw new Error(errOf(r.data, '離脱に失敗しました'))
}

/** owner: メンバーを削除（新個人チームへ戻す）。 */
export async function removeMember(userId: string): Promise<void> {
  const r = await manage({ action: 'remove', userId })
  if (!r.ok) throw new Error(errOf(r.data, 'メンバーの削除に失敗しました'))
}

/** owner: メンバーの役割を変更。 */
export async function setMemberRole(userId: string, role: 'owner' | 'member'): Promise<void> {
  const r = await manage({ action: 'role', userId, role })
  if (!r.ok) throw new Error(errOf(r.data, '役割の変更に失敗しました'))
}

/** 招待リンクのフル URL を組み立てる。 */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`
}
