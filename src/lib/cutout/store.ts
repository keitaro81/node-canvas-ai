// 撮影後工程のファイル置き場（私有バケット `batch`）へのアップロードと署名。
// パスは <team_id>/... で始まり、RLS（migration 0011: batch_path_team + is_team_member）が所属チームのみ許可する。
import { supabase } from '../supabase'
import { signMediaRequest } from '../api/storage'
import { useTeamStore } from '../../stores/teamStore'
import { getMyTeamContext } from '../api/teams'

export const BATCH_BUCKET = 'batch'

/** 対話実行（ジョブ無し）の保存先。ジョブ階層の代わりに interactive/<nodeId> を使う（仕様 4-4 の階層に準ずる）。 */
export function interactiveCutoutDir(teamId: string, nodeId: string): string {
  return `${teamId}/interactive/${nodeId}`
}

/** ログインユーザーの所属チーム ID（ストアにあればそれ、無ければ取得）。未所属ならエラー。 */
export async function resolveTeamId(): Promise<string> {
  const cached = useTeamStore.getState().context?.teamId
  if (cached) return cached
  const ctx = await getMyTeamContext()
  if (!ctx?.teamId) throw new Error('チームに所属していないため保存できません。運営にお問い合わせください。')
  return ctx.teamId
}

export async function uploadBatchObject(path: string, blob: Blob, contentType = 'image/png'): Promise<string> {
  const { error } = await supabase.storage.from(BATCH_BUCKET).upload(path, blob, { contentType, upsert: false })
  if (error) throw new Error(`保存に失敗しました: ${error.message}`)
  return path
}

// 署名 URL のキャッシュ（サーバー署名は TTL 24h。保持は 20h にして失効前に取り直す）
const SIGN_CACHE_MS = 20 * 60 * 60 * 1000
const signCache = new Map<string, { url: string; exp: number }>()

/** batch バケットのパス → 署名 URL（所属チームのパスのみ。不可なら省略）。 */
export async function signBatchPaths(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  const out: Record<string, string> = {}
  const need: string[] = []
  for (const p of paths) {
    if (!p) continue
    const c = signCache.get(p)
    if (c && c.exp > now) out[p] = c.url
    else need.push(p)
  }
  if (need.length) {
    const map = await signMediaRequest({ batchPaths: need })
    for (const [p, u] of Object.entries(map)) {
      signCache.set(p, { url: u, exp: now + SIGN_CACHE_MS })
      out[p] = u
    }
  }
  return out
}

export async function signBatchPath(path: string): Promise<string | null> {
  const map = await signBatchPaths([path])
  return map[path] ?? null
}
