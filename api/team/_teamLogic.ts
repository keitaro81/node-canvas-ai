// チーム管理の共通ロジック。Edge(/api/team/manage) と vite dev(/dev-proxy/team-manage) が共用。
// service role の Supabase クライアント(admin)を受け取り、認可・検証込みで実行する。
// 返り値 { status, body } を呼び出し側がそのまま HTTP 応答にする。
// 設計: docs/specs/team-management-mvp.md §6
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MFA_AAL2_NEEDED_MESSAGE, clearTeamMfaCache, logMfaEvent, resetUserMfa } from '../_auth'

type Role = 'owner' | 'member'

export interface TeamManageBody {
  action: 'invite' | 'join' | 'preview' | 'signup' | 'leave' | 'remove' | 'role' | 'list' | 'rename' | 'creators' | 'mfa_require' | 'mfa_reset'
  token?: string // join, preview, signup
  userId?: string // remove, role, mfa_reset の対象
  value?: boolean // mfa_require（true = このチームは 2 段階認証を必須にする）
  role?: Role // role
  email?: string // signup
  password?: string // signup
  name?: string // rename
}

/** preview / signup は未認証で呼べる（invite-gated signup）。それ以外は JWT 必須。 */
export function actionNeedsAuth(action: unknown): boolean {
  return action !== 'preview' && action !== 'signup'
}

// 招待リンク経由の参加/登録で許容するチーム人数の上限（リンク漏洩時の大量登録の歯止め）。
// 運用に応じて env で調整可能（未設定=50）。支店規模が小さい顧客では小さく絞れる。
const MAX_TEAM_MEMBERS = Number(process.env.MAX_TEAM_MEMBERS) || 50

// invite-gated signup のバースト抑制: 1チームあたり直近1時間の新規参加がこの数に達したら signup を一時停止(429)。
// 漏洩リンクからの自動大量登録を、既存の created_at のみで（無DDL・無インフラで）抑える。通常のオンボーディングは超えない想定。
const SIGNUP_MAX_PER_HOUR = Number(process.env.SIGNUP_MAX_PER_HOUR) || 20

// クォータの月次キー 'YYYY-MM'（JST基準）。api/fal/proxy.ts / src/lib/api/teams.ts の currentPeriodJst と一致させること
function currentPeriodJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 7)
}

export interface TeamManageResult {
  status: number
  body: Record<string, unknown>
}

/** 呼び出し者の保証レベル（入口が JWT から渡す）。2 段階認証の設定を変える操作は aal2（本人が 2 段階目を通している）が要る */
export interface TeamManageCtx {
  aal: 'aal1' | 'aal2'
}

// caller の所属（1ユーザー1チーム前提＝単一行）
async function myMembership(admin: any, userId: string): Promise<{ team_id: string; role: string } | null> {
  const { data } = await admin.from('team_members').select('team_id, role').eq('user_id', userId).maybeSingle()
  return data ?? null
}

async function memberCount(admin: any, teamId: string): Promise<number> {
  const { count } = await admin.from('team_members').select('user_id', { count: 'exact', head: true }).eq('team_id', teamId)
  return count ?? 0
}

async function ownerCount(admin: any, teamId: string): Promise<number> {
  const { count } = await admin
    .from('team_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('role', 'owner')
  return count ?? 0
}

// 退会/削除時: 新しい個人チームを作って user をそこへ移す（資産は user 所有なので失われない）。
// 案A（クリーンな削除）: 本人の資産を新個人チームへ追従させ、旧チームへの team 共有は private に戻す
// （＝旧チームのメンバーから見えなくする）。離脱・削除の両方がここを通る。
async function moveToNewPersonalTeam(admin: any, userId: string): Promise<void> {
  // 移動前に旧チームを控える（共有解除の対象スコープ）
  const { data: cur } = await admin.from('team_members').select('team_id').eq('user_id', userId).maybeSingle()
  const oldTeamId: string | null = cur?.team_id ?? null

  const { data: u } = await admin.auth.admin.getUserById(userId)
  const email = u?.user?.email ?? userId
  const { data: team, error } = await admin.from('teams').insert({ name: `${email} (個人)` }).select('id').single()
  if (error) throw error
  await admin.from('team_members').update({ team_id: team.id, role: 'owner' }).eq('user_id', userId)

  // 本人所有(project.user_id)の、旧チームに紐づくワークフローを処理
  if (oldTeamId && oldTeamId !== team.id) {
    const { data: projs } = await admin.from('projects').select('id').eq('user_id', userId)
    const projIds = (projs ?? []).map((p: any) => p.id)
    if (projIds.length) {
      // 1) 旧チームへの team 共有を解除（private 化）— 先に visibility を落としてから team_id を移す
      await admin.from('workflows').update({ visibility: 'private' })
        .in('project_id', projIds).eq('team_id', oldTeamId).eq('visibility', 'team')
      // 2) 本人資産の team_id を新個人チームへ追従
      await admin.from('workflows').update({ team_id: team.id })
        .in('project_id', projIds).eq('team_id', oldTeamId)
    }
  }
}

export async function teamManage(admin: any, callerId: string | null, body: TeamManageBody, ctx?: TeamManageCtx): Promise<TeamManageResult> {
  const action = body?.action
  // 未認証で呼べるのは preview / signup のみ
  if (action === 'preview') return previewInvite(admin, body.token)
  if (action === 'signup') return signupAndJoin(admin, body.token, body.email, body.password)
  if (!callerId) return { status: 403, body: { error: 'Forbidden' } }
  switch (action) {
    case 'invite':
      return invite(admin, callerId)
    case 'join':
      return join(admin, callerId, body.token)
    case 'leave':
      return leave(admin, callerId)
    case 'remove':
      return removeMember(admin, callerId, body.userId)
    case 'role':
      return changeRole(admin, callerId, body.userId, body.role)
    case 'list':
      return listMembers(admin, callerId)
    case 'rename':
      return renameTeam(admin, callerId, body.name)
    case 'creators':
      return teamCreators(admin, callerId)
    case 'mfa_require':
      return setRequireMfa(admin, callerId, body.value, ctx)
    case 'mfa_reset':
      return resetMemberMfa(admin, callerId, body.userId, ctx)
    default:
      return { status: 400, body: { error: 'Unknown action' } }
  }
}

// ── creators: 自チームの team 共有 WF の作成者（TeamPage のバッジ/フィルタ用） ──
// projects は RLS で本人のみ SELECT 可のためクライアントでは解決できず、service role で引く。
async function teamCreators(admin: any, callerId: string): Promise<TeamManageResult> {
  const m = await myMembership(admin, callerId)
  if (!m) return { status: 400, body: { error: 'チーム未所属です' } }
  const { data: wfs } = await admin
    .from('workflows')
    .select('id, projects(user_id)')
    .eq('team_id', m.team_id)
    .eq('visibility', 'team')
  const rows = (wfs ?? []) as Array<{ id: string; projects?: { user_id?: string | null } | null }>
  const userIds = [...new Set(rows.map((r) => r.projects?.user_id).filter((v): v is string => !!v))]
  const emailByUser: Record<string, string | null> = {}
  for (const uid of userIds) {
    const { data: u } = await admin.auth.admin.getUserById(uid)
    emailByUser[uid] = u?.user?.email ?? null
  }
  const creators: Record<string, { userId: string | null; email: string | null }> = {}
  for (const r of rows) {
    const uid = r.projects?.user_id ?? null
    creators[r.id] = { userId: uid, email: uid ? (emailByUser[uid] ?? null) : null }
  }
  return { status: 200, body: { creators } }
}

// ── rename: owner がチーム名（支店名）を変更 ──
async function renameTeam(admin: any, callerId: string, name?: string): Promise<TeamManageResult> {
  const m = await myMembership(admin, callerId)
  if (!m) return { status: 400, body: { error: 'チーム未所属です' } }
  if (m.role !== 'owner') return { status: 403, body: { error: 'オーナーのみ変更できます' } }
  const trimmed = (name ?? '').trim()
  if (!trimmed || trimmed.length > 60) {
    return { status: 400, body: { error: 'チーム名は1〜60文字で入力してください' } }
  }
  const { error } = await admin.from('teams').update({ name: trimmed }).eq('id', m.team_id)
  if (error) return { status: 500, body: { error: error.message } }
  return { status: 200, body: { teamName: trimmed } }
}

// ── signup: 招待トークンを登録権限とみなし、アカウント作成→そのままチームに参加（invite-gated signup） ──
// Supabase 全体の signup 設定に依らず admin API で作成する。メール確認は GA のメール基盤導入時に必須化を検討。
async function signupAndJoin(admin: any, token?: string, email?: string, password?: string): Promise<TeamManageResult> {
  const v = await validateInviteToken(admin, token)
  if ('error' in v) return v.error
  const em = (email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    return { status: 400, body: { error: 'メールアドレスの形式が正しくありません' } }
  }
  if (!password || password.length < 8) {
    return { status: 400, body: { error: 'パスワードは8文字以上にしてください' } }
  }
  if ((await memberCount(admin, v.teamId)) >= MAX_TEAM_MEMBERS) {
    return { status: 409, body: { error: 'チームの人数上限に達しています' } }
  }
  // バースト抑制: 直近1時間に同チームへ参加した人数が閾値以上なら一時停止（漏洩リンクからの大量自動登録対策）
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentJoins } = await admin
    .from('team_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('team_id', v.teamId)
    .gt('created_at', sinceIso)
  if ((recentJoins ?? 0) >= SIGNUP_MAX_PER_HOUR) {
    return { status: 429, body: { error: '登録が集中しています。しばらくしてから再度お試しください' } }
  }
  const { data: created, error } = await admin.auth.admin.createUser({ email: em, password, email_confirm: true })
  if (error || !created?.user) {
    const msg = String(error?.message ?? '')
    if (error?.status === 422 || msg.toLowerCase().includes('already')) {
      return { status: 409, body: { error: 'このメールアドレスは登録済みです。ログインして参加してください', code: 'already_registered' } }
    }
    return { status: 500, body: { error: msg || '登録に失敗しました' } }
  }
  await admin.from('team_members').insert({ team_id: v.teamId, user_id: created.user.id, role: 'member' })
  const { data: t } = await admin.from('teams').select('name').eq('id', v.teamId).maybeSingle()
  return { status: 200, body: { teamId: v.teamId, teamName: t?.name ?? null } }
}

// ── invite: owner が招待リンクを発行（旧アクティブを revoke→新規 insert） ──
async function invite(admin: any, callerId: string): Promise<TeamManageResult> {
  const m = await myMembership(admin, callerId)
  if (!m) return { status: 400, body: { error: 'チーム未所属です' } }
  if (m.role !== 'owner') return { status: 403, body: { error: 'オーナーのみ招待できます' } }
  await admin.from('team_invites').update({ revoked_at: new Date().toISOString() }).eq('team_id', m.team_id).is('revoked_at', null)
  const { data, error } = await admin
    .from('team_invites')
    .insert({ team_id: m.team_id, created_by: callerId })
    .select('token, expires_at')
    .single()
  if (error) return { status: 500, body: { error: error.message } }
  return { status: 200, body: { token: data.token, expiresAt: data.expires_at, teamId: m.team_id } }
}

// ── token 検証（join / preview 共通）。OK なら teamId、NG なら HTTP 応答を返す ──
async function validateInviteToken(admin: any, token?: string): Promise<{ error: TeamManageResult } | { teamId: string }> {
  if (!token) return { error: { status: 400, body: { error: 'token がありません' } } }
  const { data: inv } = await admin.from('team_invites').select('team_id, expires_at, revoked_at').eq('token', token).maybeSingle()
  if (!inv) return { error: { status: 410, body: { error: '無効な招待リンクです' } } }
  if (inv.revoked_at) return { error: { status: 410, body: { error: 'この招待リンクは無効化されています' } } }
  if (new Date(inv.expires_at).getTime() < Date.now()) return { error: { status: 410, body: { error: 'この招待リンクは期限切れです' } } }
  return { teamId: inv.team_id }
}

// ── preview: 参加前の確認用にチーム名だけ返す（書込なし・token 検証は join と同一） ──
async function previewInvite(admin: any, token?: string): Promise<TeamManageResult> {
  const v = await validateInviteToken(admin, token)
  if ('error' in v) return v.error
  const { data: t } = await admin.from('teams').select('name').eq('id', v.teamId).maybeSingle()
  return { status: 200, body: { teamName: t?.name ?? null } }
}

// ── join: token 検証→呼び出し者を当該チームへ移動（or 新規行 insert） ──
async function join(admin: any, callerId: string, token?: string): Promise<TeamManageResult> {
  const v = await validateInviteToken(admin, token)
  if ('error' in v) return v.error

  const targetTeam: string = v.teamId
  const m = await myMembership(admin, callerId)

  if (m && m.team_id === targetTeam) {
    const { data: t } = await admin.from('teams').select('name').eq('id', targetTeam).maybeSingle()
    return { status: 200, body: { teamId: targetTeam, teamName: t?.name, already: true } }
  }

  if ((await memberCount(admin, targetTeam)) >= MAX_TEAM_MEMBERS) {
    return { status: 409, body: { error: 'チームの人数上限に達しています' } }
  }

  // 最後の owner ガード（呼び出し者が「他メンバーのいるチームの唯一の owner」なら移動不可）
  if (m) {
    const members = await memberCount(admin, m.team_id)
    if (members > 1 && m.role === 'owner') {
      const owners = await ownerCount(admin, m.team_id)
      if (owners <= 1) {
        return { status: 409, body: { error: '現在のチームの最後のオーナーです。先に他メンバーへオーナーを譲ってください' } }
      }
    }
  }

  const oldTeam = m?.team_id ?? null
  if (m) {
    await admin.from('team_members').update({ team_id: targetTeam, role: 'member' }).eq('user_id', callerId)
  } else {
    await admin.from('team_members').insert({ team_id: targetTeam, user_id: callerId, role: 'member' })
  }

  // 旧チームが空（個人チーム）なら掃除
  if (oldTeam && oldTeam !== targetTeam) {
    const remaining = await memberCount(admin, oldTeam)
    if (remaining === 0) await admin.from('teams').delete().eq('id', oldTeam)
  }

  clearTeamMfaCache(callerId)   // 所属が変わった: 新しいチームの「2 段階認証が必須か」をすぐ見る
  const { data: t } = await admin.from('teams').select('name').eq('id', targetTeam).maybeSingle()
  return { status: 200, body: { teamId: targetTeam, teamName: t?.name } }
}

// ── leave: 自分を新個人チームへ戻す ──
async function leave(admin: any, callerId: string): Promise<TeamManageResult> {
  const m = await myMembership(admin, callerId)
  if (!m) return { status: 400, body: { error: 'チーム未所属です' } }
  const members = await memberCount(admin, m.team_id)
  if (members <= 1) return { status: 200, body: { noop: true } } // 既に1人＝個人チーム
  if (m.role === 'owner') {
    const owners = await ownerCount(admin, m.team_id)
    if (owners <= 1) return { status: 409, body: { error: '最後のオーナーです。先に他メンバーをオーナーにしてください' } }
  }
  await moveToNewPersonalTeam(admin, callerId)
  clearTeamMfaCache(callerId)
  return { status: 200, body: { left: true } }
}

// ── remove: owner が member を新個人チームへ戻す ──
async function removeMember(admin: any, callerId: string, targetUserId?: string): Promise<TeamManageResult> {
  if (!targetUserId) return { status: 400, body: { error: 'userId がありません' } }
  const m = await myMembership(admin, callerId)
  if (!m || m.role !== 'owner') return { status: 403, body: { error: 'オーナーのみ削除できます' } }
  if (targetUserId === callerId) return { status: 400, body: { error: '自分自身は削除できません（離脱を使用）' } }
  const { data: tgt } = await admin.from('team_members').select('team_id').eq('user_id', targetUserId).maybeSingle()
  if (!tgt || tgt.team_id !== m.team_id) return { status: 404, body: { error: 'そのメンバーは見つかりません' } }
  await moveToNewPersonalTeam(admin, targetUserId)
  clearTeamMfaCache(targetUserId)
  return { status: 200, body: { removed: true } }
}

// ── role: owner が member の役割を変更（最後の owner 降格はガード） ──
async function changeRole(admin: any, callerId: string, targetUserId?: string, role?: Role): Promise<TeamManageResult> {
  if (!targetUserId || (role !== 'owner' && role !== 'member')) return { status: 400, body: { error: '不正なリクエストです' } }
  const m = await myMembership(admin, callerId)
  if (!m || m.role !== 'owner') return { status: 403, body: { error: 'オーナーのみ変更できます' } }
  const { data: tgt } = await admin.from('team_members').select('team_id, role').eq('user_id', targetUserId).maybeSingle()
  if (!tgt || tgt.team_id !== m.team_id) return { status: 404, body: { error: 'そのメンバーは見つかりません' } }
  if (tgt.role === 'owner' && role === 'member') {
    const owners = await ownerCount(admin, m.team_id)
    if (owners <= 1) return { status: 409, body: { error: '最後のオーナーは降格できません' } }
  }
  await admin.from('team_members').update({ role }).eq('user_id', targetUserId).eq('team_id', m.team_id)
  return { status: 200, body: { updated: true } }
}

// ── list: チーム情報＋メンバー（email 付き）＋owner なら現在の招待リンク ──
async function listMembers(admin: any, callerId: string): Promise<TeamManageResult> {
  const m = await myMembership(admin, callerId)
  if (!m) return { status: 400, body: { error: 'チーム未所属です' } }

  const { data: rows } = await admin.from('team_members').select('user_id, role, created_at').eq('team_id', m.team_id)

  // 使用状況（当月・メンバー別）。usage_counters は PK(team_id,user_id,period,kind)＝行ごとに一意。
  // 退職済みメンバーの消費も team 合計には含まれる（メンバー行には出ない）。
  const period = currentPeriodJst()
  const { data: usageRows } = await admin
    .from('usage_counters')
    .select('user_id, kind, count')
    .eq('team_id', m.team_id)
    .eq('period', period)
  const byMember: Record<string, { image: number; video: number }> = {}
  let usedImage = 0
  let usedVideo = 0
  for (const r of (usageRows ?? []) as Array<{ user_id: string; kind: string; count: number }>) {
    const u = (byMember[r.user_id] = byMember[r.user_id] ?? { image: 0, video: 0 })
    if (r.kind === 'image') { u.image += r.count ?? 0; usedImage += r.count ?? 0 }
    else if (r.kind === 'video') { u.video += r.count ?? 0; usedVideo += r.count ?? 0 }
  }

  // 2 段階認証の状態（0023 の RPC。未適用の環境では null = 不明）
  const mfaByMember = await mfaOverview(admin, m.team_id)

  const members: Array<Record<string, unknown>> = []
  for (const r of rows ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(r.user_id)
    members.push({
      userId: r.user_id,
      email: u?.user?.email ?? null,
      role: r.role,
      isMe: r.user_id === callerId,
      usedImage: byMember[r.user_id]?.image ?? 0,
      usedVideo: byMember[r.user_id]?.video ?? 0,
      mfa: mfaByMember ? mfaByMember[r.user_id] === true : null,
    })
  }

  const team = await teamRow(admin, m.team_id)

  // owner のみ現在のアクティブ招待リンクを返す
  let invite: { token: string; expiresAt: string } | null = null
  if (m.role === 'owner') {
    const { data: inv } = await admin
      .from('team_invites')
      .select('token, expires_at')
      .eq('team_id', m.team_id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (inv) invite = { token: inv.token, expiresAt: inv.expires_at }
  }

  return {
    status: 200,
    body: {
      teamId: m.team_id,
      teamName: team?.name ?? null,
      myRole: m.role,
      quota: team ? { image: team.quota_image_monthly, video: team.quota_video_monthly } : null,
      usage: { period, usedImage, usedVideo },
      members,
      invite,
      requireMfa: team?.require_mfa ?? null,   // null = 0023 未適用（画面は欄を出さない）
    },
  }
}

// ────────────────────────────────────────────
// 2 段階認証（2026-11-14・設計 docs/specs/two-factor-auth.md）
// ────────────────────────────────────────────

// チームの行。require_mfa は 0023 で足した列なので、未適用の環境では列なしで引き直す（一覧を壊さない）
async function teamRow(admin: any, teamId: string): Promise<{ name: string | null; quota_image_monthly: number; quota_video_monthly: number; require_mfa: boolean | null } | null> {
  const withFlag = await admin.from('teams').select('name, quota_image_monthly, quota_video_monthly, require_mfa').eq('id', teamId).maybeSingle()
  if (!withFlag.error) return withFlag.data ? { ...withFlag.data, require_mfa: withFlag.data.require_mfa === true } : null
  const plain = await admin.from('teams').select('name, quota_image_monthly, quota_video_monthly').eq('id', teamId).maybeSingle()
  return plain.data ? { ...plain.data, require_mfa: null } : null
}

// メンバーごとの「認証アプリを登録済みか」（0023 の team_mfa_overview。未適用なら null = 不明）
async function mfaOverview(admin: any, teamId: string): Promise<Record<string, boolean> | null> {
  const { data, error } = await admin.rpc('team_mfa_overview', { p_team_id: teamId })
  if (error || !Array.isArray(data)) return null
  const map: Record<string, boolean> = {}
  for (const r of data as Array<{ user_id: string; has_factor: boolean }>) map[r.user_id] = r.has_factor === true
  return map
}

// ── mfa_require: owner がチームの 2 段階認証を必須にする / 外す（操作する本人が 2 段階認証済みであること）──
async function setRequireMfa(admin: any, callerId: string, value: boolean | undefined, ctx?: TeamManageCtx): Promise<TeamManageResult> {
  if (typeof value !== 'boolean') return { status: 400, body: { error: '不正なリクエストです' } }
  const m = await myMembership(admin, callerId)
  if (!m || m.role !== 'owner') return { status: 403, body: { error: 'オーナーのみ変更できます' } }
  if (ctx?.aal !== 'aal2') return { status: 403, body: { error: MFA_AAL2_NEEDED_MESSAGE, code: 'mfa_aal2_needed' } }
  const { error } = await admin.from('teams').update({ require_mfa: value }).eq('id', m.team_id)
  if (error) return { status: 500, body: { error: `設定を保存できませんでした（データベースの更新 0023 が未適用の可能性があります）: ${error.message ?? ''}` } }
  clearTeamMfaCache()
  await logMfaEvent(admin, { actor_id: callerId, target_user_id: null, team_id: m.team_id, action: value ? 'require_on' : 'require_off' })
  return { status: 200, body: { requireMfa: value } }
}

// ── mfa_reset: owner が同じチームのメンバーの認証アプリの登録を消す（端末をなくしたとき）──
// 自分自身は対象外（Account から変える）。操作する本人が 2 段階認証済みであること（パスワードだけ盗まれたオーナーのアカウントから外されないように）
async function resetMemberMfa(admin: any, callerId: string, targetUserId: string | undefined, ctx?: TeamManageCtx): Promise<TeamManageResult> {
  if (!targetUserId) return { status: 400, body: { error: 'userId がありません' } }
  const m = await myMembership(admin, callerId)
  if (!m || m.role !== 'owner') return { status: 403, body: { error: 'オーナーのみリセットできます' } }
  if (targetUserId === callerId) return { status: 400, body: { error: '自分の 2 段階認証は Account から変更してください' } }
  if (ctx?.aal !== 'aal2') return { status: 403, body: { error: MFA_AAL2_NEEDED_MESSAGE, code: 'mfa_aal2_needed' } }
  const { data: tgt } = await admin.from('team_members').select('team_id').eq('user_id', targetUserId).maybeSingle()
  if (!tgt || tgt.team_id !== m.team_id) return { status: 404, body: { error: 'そのメンバーは見つかりません' } }
  let removed: number
  try {
    removed = await resetUserMfa(admin, targetUserId)
  } catch (e) {
    return { status: 500, body: { error: `リセットに失敗しました: ${e instanceof Error ? e.message : String(e)}` } }
  }
  await logMfaEvent(admin, { actor_id: callerId, target_user_id: targetUserId, team_id: m.team_id, action: 'reset_by_owner', detail: { removed } })
  return { status: 200, body: { reset: true, removed } }
}
