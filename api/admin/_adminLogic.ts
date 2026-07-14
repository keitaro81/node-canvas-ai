// 運営（オペレーター）専用の管理ロジック。Edge(/api/admin/manage) と vite dev(/dev-proxy/admin-manage) が共用。
// ⚠️ スーパーユーザー面: 他人のアカウント作成・全チーム横断を行う。呼び出しは必ず isOperator で allowlist ゲートすること。
// 認可（誰が運営か）は環境変数 ADMIN_USER_IDS（user_id のカンマ区切り）。マイグレーション不要。
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AdminManageBody {
  action: 'provision' | 'list'
  teamName?: string   // provision
  ownerEmail?: string // provision
  quotaImage?: number // provision（既定100）
  quotaVideo?: number // provision（既定7）
}

export interface AdminResult {
  status: number
  body: Record<string, unknown>
}

/** 呼び出し者が運営 allowlist に含まれるか。allowlist は ADMIN_USER_IDS（カンマ区切り）。 */
export function isOperator(userId: string | null | undefined, adminIdsEnv: string | undefined): boolean {
  if (!userId || !adminIdsEnv) return false
  const ids = adminIdsEnv.split(',').map((s) => s.trim()).filter(Boolean)
  return ids.includes(userId)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normQuota(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

/** 運営ゲート込みのディスパッチャ。userId は検証済み JWT の uid、adminIdsEnv は ADMIN_USER_IDS。 */
export async function adminManage(
  admin: any,
  userId: string | null,
  adminIdsEnv: string | undefined,
  body: AdminManageBody,
): Promise<AdminResult> {
  if (!isOperator(userId, adminIdsEnv)) return { status: 403, body: { error: 'Forbidden' } }
  switch (body?.action) {
    case 'provision':
      return provisionBranch(admin, body)
    case 'list':
      return listBranches(admin)
    default:
      return { status: 400, body: { error: 'Unknown action' } }
  }
}

// ── provision: チーム＋owner アカウント＋owner 所属を一括作成（案A） ──
// owner のパスワードはランダム生成して破棄（運営は触れない）。owner は「パスワード再設定」でログインする。
async function provisionBranch(admin: any, body: AdminManageBody): Promise<AdminResult> {
  const name = (body.teamName ?? '').trim()
  const email = (body.ownerEmail ?? '').trim().toLowerCase()
  if (!name || name.length > 60) return { status: 400, body: { error: 'チーム名は1〜60文字で入力してください' } }
  if (!EMAIL_RE.test(email)) return { status: 400, body: { error: 'オーナーのメールアドレスの形式が正しくありません' } }
  const quotaImage = normQuota(body.quotaImage, 100)
  const quotaVideo = normQuota(body.quotaVideo, 7)

  // owner アカウント作成（email_confirm・ランダムpwは破棄＝運営は知らない）。
  // 注: bcrypt の 72 バイト上限に収めること（UUID=36文字で十分な entropy）。
  const randomPw = crypto.randomUUID()
  const { data: created, error: userErr } = await admin.auth.admin.createUser({ email, password: randomPw, email_confirm: true })
  if (userErr || !created?.user) {
    const msg = String(userErr?.message ?? '')
    if (userErr?.status === 422 || msg.toLowerCase().includes('already')) {
      return { status: 409, body: { error: 'このメールは既に登録済みです。既存アカウントをオーナーにする場合は運用手順の SQL 例外を使ってください', code: 'already_registered' } }
    }
    return { status: 500, body: { error: msg || 'オーナーの作成に失敗しました' } }
  }
  const ownerId: string = created.user.id

  // チーム作成
  const { data: team, error: teamErr } = await admin
    .from('teams')
    .insert({ name, quota_image_monthly: quotaImage, quota_video_monthly: quotaVideo })
    .select('id')
    .single()
  if (teamErr || !team) {
    // owner は作成済みだが team 失敗。オーファンを避けるため owner を削除して巻き戻す。
    await admin.auth.admin.deleteUser(ownerId).catch(() => {})
    return { status: 500, body: { error: `チームの作成に失敗しました: ${teamErr?.message ?? ''}` } }
  }

  // owner 所属
  const { error: memErr } = await admin.from('team_members').insert({ team_id: team.id, user_id: ownerId, role: 'owner' })
  if (memErr) {
    return { status: 500, body: { error: `オーナー登録に失敗しました: ${memErr.message}`, teamId: team.id, ownerUserId: ownerId } }
  }

  return { status: 200, body: { teamId: team.id, teamName: name, ownerUserId: ownerId, ownerEmail: email, quotaImage, quotaVideo } }
}

// ── list: 全チーム＝名前・クォータ・メンバー数・owner・今月消費 ──
async function listBranches(admin: any): Promise<AdminResult> {
  const { data: teams } = await admin
    .from('teams')
    .select('id, name, quota_image_monthly, quota_video_monthly, created_at')
    .order('created_at', { ascending: true })
  const teamRows = (teams ?? []) as Array<{ id: string; name: string; quota_image_monthly: number; quota_video_monthly: number; created_at: string }>

  const { data: members } = await admin.from('team_members').select('team_id, user_id, role')
  const memberRows = (members ?? []) as Array<{ team_id: string; user_id: string; role: string }>

  // 今月消費（JST period）を全チーム分まとめて
  const period = currentPeriodJst()
  const { data: usage } = await admin.from('usage_counters').select('team_id, kind, count').eq('period', period)
  const usageRows = (usage ?? []) as Array<{ team_id: string; kind: string; count: number }>

  const countByTeam: Record<string, number> = {}
  const ownersByTeam: Record<string, string[]> = {}
  for (const m of memberRows) {
    countByTeam[m.team_id] = (countByTeam[m.team_id] ?? 0) + 1
    if (m.role === 'owner') (ownersByTeam[m.team_id] = ownersByTeam[m.team_id] ?? []).push(m.user_id)
  }
  const usageByTeam: Record<string, { image: number; video: number }> = {}
  for (const u of usageRows) {
    const t = (usageByTeam[u.team_id] = usageByTeam[u.team_id] ?? { image: 0, video: 0 })
    if (u.kind === 'image') t.image += u.count ?? 0
    else if (u.kind === 'video') t.video += u.count ?? 0
  }

  // owner の email 解決（チーム数ぶんの getUserById・ピロット規模なら十分）
  const emailCache: Record<string, string | null> = {}
  const resolveEmail = async (uid: string): Promise<string | null> => {
    if (uid in emailCache) return emailCache[uid]
    const { data: u } = await admin.auth.admin.getUserById(uid)
    return (emailCache[uid] = u?.user?.email ?? null)
  }

  const branches = []
  for (const t of teamRows) {
    const ownerIds = ownersByTeam[t.id] ?? []
    const ownerEmails: string[] = []
    for (const oid of ownerIds) ownerEmails.push((await resolveEmail(oid)) ?? oid)
    branches.push({
      teamId: t.id,
      name: t.name,
      memberCount: countByTeam[t.id] ?? 0,
      owners: ownerEmails,
      quotaImage: t.quota_image_monthly,
      quotaVideo: t.quota_video_monthly,
      usedImage: usageByTeam[t.id]?.image ?? 0,
      usedVideo: usageByTeam[t.id]?.video ?? 0,
      createdAt: t.created_at,
    })
  }
  return { status: 200, body: { period, branches } }
}

// クォータ月次キー 'YYYY-MM'（JST）。api/fal/proxy.ts / api/team/_teamLogic.ts と一致させること。
function currentPeriodJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 7)
}
