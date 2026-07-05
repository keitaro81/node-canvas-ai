// sign-media の共通サーバーロジック。Edge(/api/storage/sign-media) と vite dev(/dev-proxy/sign-media) が共用。
// L2 テナント分離: 署名は service role の本コアのみが行い、呼び出し者(userId)のアクセス権を検証してから署名する。
// 3つの入力（混在可）:
//   { workflowId } … そのWFにアクセス可能なら canvas_data+thumbnail の全メディアを署名（loadWorkflow）
//   { urls }       … generations.output_url。所有 or そのWFが public/team 共有なら署名（History/サムネ）
//   { ownUrls }    … storage.objects.owner が本人のオブジェクトのみ署名（生成/参照アップロード直後の即時表示）
// 返り値 { status, body }。200={map}（不可は省略）／403（workflowId のアクセス不可）。
/* eslint-disable @typescript-eslint/no-explicit-any */

const SIGNED_URL_TTL = 60 * 60 * 24 // 24h — src/lib/api/storage.ts の SIGNED_URL_TTL と一致させること
const PRIVATE_BUCKETS = ['generated-images', 'generated-videos']
const MAX_URLS = 600

// canvas_data ノード data に保存され得るメディアURLフィールド。
// 重要: src/lib/api/signMedia.ts ・ api/cron/cleanup-orphan-storage.ts の参照集合と一致させること。
const TOP_LEVEL_URL_FIELDS = ['output', 'videoUrl', 'imageUrl', 'uploadedImagePreview', 'maskUrl']
const PARAM_URL_FIELDS = ['imageUrl', 'maskUrl']

/** 公開形式 /object/public/ と署名形式 /object/sign/...?token= の両方から自前バケットの {bucket,path} を抽出。 */
function parseStorageUrl(url: unknown): { bucket: string; path: string } | null {
  if (!url || typeof url !== 'string') return null
  for (const marker of ['/object/public/', '/object/sign/']) {
    const i = url.indexOf(marker)
    if (i === -1) continue
    let rest = url.slice(i + marker.length)
    const q = rest.indexOf('?'); if (q !== -1) rest = rest.slice(0, q)
    const slash = rest.indexOf('/'); if (slash === -1) return null
    const bucket = rest.slice(0, slash)
    if (!PRIVATE_BUCKETS.includes(bucket)) return null
    const path = decodeURIComponent(rest.slice(slash + 1))
    return path ? { bucket, path } : null
  }
  return null
}

/** canvas_data + thumbnail から自前バケットのメディアURL文字列（canonical）を集める。 */
function collectCanvasMedia(canvasData: any, thumbnailUrl: string | null): string[] {
  const out: string[] = []
  const add = (v: unknown) => { if (typeof v === 'string' && v && parseStorageUrl(v)) out.push(v) }
  add(thumbnailUrl)
  const nodes = canvasData?.nodes
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const d = n?.data ?? {}
      for (const f of TOP_LEVEL_URL_FIELDS) add(d[f])
      if (d.params) for (const f of PARAM_URL_FIELDS) add(d.params[f])
    }
  }
  return out
}

/** 入力URL群をバケット単位で一括署名し、{ 入力URL: 署名URL } を返す（自前バケット以外/失敗は省略）。 */
async function signUrls(admin: any, urls: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const buckets = new Map<string, Map<string, string[]>>() // bucket -> path -> 元URL群
  for (const u of urls) {
    if (out[u]) continue
    const parsed = parseStorageUrl(u)
    if (!parsed) continue
    let pm = buckets.get(parsed.bucket); if (!pm) { pm = new Map(); buckets.set(parsed.bucket, pm) }
    const arr = pm.get(parsed.path); if (arr) arr.push(u); else pm.set(parsed.path, [u])
  }
  for (const [bucket, pm] of buckets) {
    const paths = [...pm.keys()]; if (!paths.length) continue
    try {
      const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL)
      if (error || !data) continue
      for (const item of data as Array<{ error: string | null; path: string | null; signedUrl: string }>) {
        if (item.error || !item.signedUrl || !item.path) continue
        const vals = pm.get(item.path)
        if (vals) for (const v of vals) out[v] = item.signedUrl
      }
    } catch { continue }
  }
  return out
}

/** 各 url の generations 行を引き、所有 or その WF が public/team 共有なら許可。許可URLの配列を返す。 */
async function authorizeGenerationUrls(admin: any, urls: string[], userId: string, callerTeamId: string | null): Promise<string[]> {
  if (!urls.length) return []
  const { data: gens } = await admin.from('generations').select('output_url, user_id, workflow_id').in('output_url', urls)
  const rows = (gens ?? []) as Array<{ output_url: string | null; user_id: string | null; workflow_id: string | null }>
  const allowed: string[] = []
  const needWf: typeof rows = []
  for (const g of rows) {
    if (!g.output_url) continue
    if (g.user_id === userId) allowed.push(g.output_url)
    else if (g.workflow_id) needWf.push(g)
  }
  if (needWf.length) {
    const wfIds = [...new Set(needWf.map((g) => g.workflow_id))]
    const { data: wfs } = await admin.from('workflows').select('id, visibility, team_id').in('id', wfIds)
    const wfMap = new Map<string, any>((wfs ?? []).map((w: any) => [w.id, w]))
    for (const g of needWf) {
      const w = wfMap.get(g.workflow_id as string)
      if (!w) continue
      const ok = w.visibility === 'public' || (w.visibility === 'team' && !!w.team_id && !!callerTeamId && w.team_id === callerTeamId)
      if (ok && g.output_url) allowed.push(g.output_url)
    }
  }
  return allowed
}

export interface SignMediaResult {
  status: number
  body: Record<string, unknown>
}

export async function signMediaServer(
  admin: any,
  userId: string,
  body: { workflowId?: string; urls?: unknown; ownUrls?: unknown },
): Promise<SignMediaResult> {
  // 呼び出し者の所属チーム（未所属＝null）
  const { data: member } = await admin.from('team_members').select('team_id').eq('user_id', userId).limit(1).maybeSingle()
  const callerTeamId: string | null = member?.team_id ?? null

  const toSign: string[] = []

  // ---- Mode 1: workflowId（canvas のメディア）----
  if (typeof body.workflowId === 'string' && body.workflowId) {
    const { data: wf } = await admin
      .from('workflows')
      .select('project_id, canvas_data, thumbnail_url, visibility, team_id, projects(user_id)')
      .eq('id', body.workflowId)
      .maybeSingle()
    if (wf) {
      const w = wf as any
      const ownerId: string | undefined = w.projects?.user_id
      const visibility: string = w.visibility ?? 'private'
      const isOwner = !!ownerId && ownerId === userId
      const isPublic = visibility === 'public'
      const isTeam = visibility === 'team' && !!w.team_id && !!callerTeamId && w.team_id === callerTeamId
      if (isOwner || isPublic || isTeam) {
        toSign.push(...collectCanvasMedia(w.canvas_data, w.thumbnail_url))
      } else {
        return { status: 403, body: { error: 'Forbidden' } }
      }
    }
  }

  // ---- Mode 2: urls（generations.output_url。所有 or WF が public/team 共有なら可）----
  if (Array.isArray(body.urls) && body.urls.length) {
    const urls = (body.urls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, MAX_URLS)
    const allowed = await authorizeGenerationUrls(admin, urls, userId, callerTeamId)
    toSign.push(...allowed)
  }

  // ---- ownUrls: storage.objects.owner が本人のオブジェクトのみ（即時表示）----
  if (Array.isArray(body.ownUrls) && body.ownUrls.length) {
    const ownUrls = (body.ownUrls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, MAX_URLS)
    const keys: string[] = []
    const keyToUrls = new Map<string, string[]>()
    for (const u of ownUrls) {
      const p = parseStorageUrl(u); if (!p) continue
      const key = `${p.bucket}/${p.path}`
      keys.push(key)
      const arr = keyToUrls.get(key); if (arr) arr.push(u); else keyToUrls.set(key, [u])
    }
    if (keys.length) {
      // RPC: 呼び出し者が owner のキーのみ返す（0009 で定義）
      const { data: ownedKeys } = await admin.rpc('storage_keys_owned_by', { p_user: userId, p_keys: keys })
      for (const k of (ownedKeys ?? []) as string[]) {
        const urls = keyToUrls.get(k); if (urls) toSign.push(...urls)
      }
    }
  }

  const map = await signUrls(admin, toSign)
  return { status: 200, body: { map } }
}
