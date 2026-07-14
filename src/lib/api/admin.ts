import { supabase } from '../supabase'

// 運営（オペレーター）専用 API クライアント。/api/admin/manage（dev は /dev-proxy/admin-manage）経由。
// サーバー側で ADMIN_USER_IDS allowlist によりゲートされる。非運営には 403。

export interface AdminBranch {
  teamId: string
  name: string
  memberCount: number
  owners: string[]
  quotaImage: number
  quotaVideo: number
  usedImage: number
  usedVideo: number
  createdAt: string
}

export interface AdminBranchList {
  period: string
  branches: AdminBranch[]
}

export interface ProvisionResult {
  teamId: string
  teamName: string
  ownerUserId: string
  ownerEmail: string
  quotaImage: number
  quotaVideo: number
}

interface AdminBody {
  action: 'provision' | 'list'
  teamName?: string
  ownerEmail?: string
  quotaImage?: number
  quotaVideo?: number
}

async function adminApi(body: AdminBody): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, status: 401, data: { error: 'Not authenticated' } }
  const endpoint = import.meta.env.VITE_FAL_KEY ? '/dev-proxy/admin-manage' : '/api/admin/manage'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  let data: Record<string, unknown> = {}
  try { data = (await res.json()) as Record<string, unknown> } catch { /* 空応答は無視 */ }
  return { ok: res.ok, status: res.status, data }
}

function errOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === 'string' ? data.error : fallback
}

/** 全チームの一覧（運営のみ）。非運営は 403 を投げる。 */
export async function listAdminBranches(): Promise<AdminBranchList> {
  const r = await adminApi({ action: 'list' })
  if (!r.ok) {
    const e = new Error(errOf(r.data, 'チーム一覧の取得に失敗しました')) as Error & { status?: number }
    e.status = r.status
    throw e
  }
  return r.data as unknown as AdminBranchList
}

/** チーム＋owner アカウントを作成（運営のみ）。 */
export async function provisionBranch(input: {
  teamName: string
  ownerEmail: string
  quotaImage: number
  quotaVideo: number
}): Promise<ProvisionResult> {
  const r = await adminApi({ action: 'provision', ...input })
  if (!r.ok) {
    const e = new Error(errOf(r.data, 'チームの作成に失敗しました')) as Error & { status?: number; code?: string }
    e.status = r.status
    if (typeof r.data.code === 'string') e.code = r.data.code
    throw e
  }
  return r.data as unknown as ProvisionResult
}
