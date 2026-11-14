// Edge Functions と dev ミドルウェア共通の「2 段階認証の確認」（2026-11-14・設計 docs/specs/two-factor-auth.md §3）。
// `_` 始まりのファイルは Vercel のルーティング対象外（共有モジュール）。
//
// JWT の検証（Supabase Auth への問い合わせ）は各入口が従来どおり行う。ここは、検証済みの user とそのトークンから
// 「2 段階目が必要なのに済んでいないか」を判定する。規則は src/lib/auth/mfaGate.ts（画面・DB と同じ）。
// Edge は認証後に service role で動く（RLS を通らない）ので、ここで止めないと API の直叩きを防げない。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { aalOfJwt, hasVerifiedFactor, mfaGateOf, mfaRequiredBody, type Aal, type MfaGate } from '../src/lib/auth/mfaGate'

/** 検証済みの呼び出し者 */
export interface Caller {
  userId: string
  aal: Aal
  hasVerifiedFactor: boolean
}

/** Supabase Auth の user（/auth/v1/user の応答・auth.getUser の user）とトークンから呼び出し者を作る */
export function callerOf(user: { id: string; factors?: ReadonlyArray<{ status?: string | null } | null> | null }, token: string): Caller {
  return { userId: user.id, aal: aalOfJwt(token), hasVerifiedFactor: hasVerifiedFactor(user.factors) }
}

// チームの必須フラグは短くキャッシュする（fal の状態確認のように、同じ人から続けて来る呼び出しで毎回 DB を引かない）。
// 切り替えは 30 秒以内に効く（DB の RLS は即時）。
const TEAM_REQ_TTL_MS = 30_000
const TEAM_REQ_CACHE_MAX = 5_000
const teamReqCache = new Map<string, { value: boolean; at: number }>()

/** マイグレーション 0023 が未適用（関数が無い）か */
function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code ?? ''
  return code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(error?.message ?? '')
}

/** その人の所属チームが 2 段階認証を必須にしているか（0023 未適用なら false） */
export async function teamRequiresMfa(admin: any, userId: string, now: number = Date.now()): Promise<boolean> {
  const hit = teamReqCache.get(userId)
  if (hit && now - hit.at < TEAM_REQ_TTL_MS) return hit.value
  const { data, error } = await admin.rpc('team_requires_mfa', { p_user_id: userId })
  if (error && !isMissingFunction(error)) throw new Error(`team_requires_mfa failed: ${error.message ?? error.code ?? 'unknown'}`)
  const value = !error && data === true
  if (teamReqCache.size >= TEAM_REQ_CACHE_MAX) teamReqCache.clear()
  teamReqCache.set(userId, { value, at: now })
  return value
}

/** 必須フラグを切り替えた直後など、キャッシュを捨てる（userId 省略で全部） */
export function clearTeamMfaCache(userId?: string): void {
  if (userId) teamReqCache.delete(userId)
  else teamReqCache.clear()
}

/** 呼び出し者の判定。aal2 なら DB を引かずに通す */
export async function mfaGateFor(admin: any, caller: Caller): Promise<MfaGate> {
  if (caller.aal === 'aal2') return 'ok'
  if (caller.hasVerifiedFactor) return 'challenge'
  return mfaGateOf({ aal: caller.aal, hasVerifiedFactor: false, requiredByTeam: await teamRequiresMfa(admin, caller.userId) })
}

/** 通してよければ null。だめなら入口がそのまま返す 403（本文の code = 'mfa_required'） */
export async function mfaBlock(admin: any, caller: Caller): Promise<{ status: 403; body: { error: string; code: string; gate: string } } | null> {
  const gate = await mfaGateFor(admin, caller)
  return gate === 'ok' ? null : { status: 403, body: mfaRequiredBody(gate) }
}

// ────────────────────────────────────────────
// リセット（端末をなくしたとき）: オーナー（api/team）と運営（api/admin）が使う
// ────────────────────────────────────────────

/** 2 段階認証の設定を変える操作（必須の切り替え・他人のリセット）に、操作する本人の 2 段階認証が要るときの文 */
export const MFA_AAL2_NEEDED_MESSAGE = 'この操作には、あなた自身の 2 段階認証が必要です。Account で認証アプリを登録（登録済みならログインし直してコードを入力）してから、もう一度お試しください'

/** その人の要素（認証アプリ）をすべて消す。消した数を返す。次のログインからはパスワードだけになる（チームが必須なら登録し直し） */
export async function resetUserMfa(admin: any, userId: string): Promise<number> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId })
  if (error) throw new Error(error.message ?? 'listFactors failed')
  const factors = (data?.factors ?? []) as Array<{ id: string }>
  for (const f of factors) {
    const r = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId })
    if (r?.error) throw new Error(r.error.message ?? 'deleteFactor failed')
  }
  return factors.length
}

export interface MfaEvent {
  actor_id: string | null
  target_user_id: string | null
  team_id: string | null
  action: 'reset_by_owner' | 'reset_by_operator' | 'require_on' | 'require_off'
  detail?: Record<string, unknown>
}

/** 操作の記録（0023 の mfa_events）。記録に失敗しても操作は止めない（未適用の環境では表が無い） */
export async function logMfaEvent(admin: any, event: MfaEvent): Promise<void> {
  try {
    await admin.from('mfa_events').insert({ ...event, detail: event.detail ?? {} })
  } catch {
    // 最善努力
  }
}
