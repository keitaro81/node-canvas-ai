// 2 段階認証の判定（2026-11-14・設計 docs/specs/two-factor-auth.md §3）。
// 画面（AuthGuard）・Edge Functions（api/_auth.ts）・DB（migrations/0023 の mfa_satisfied()）が同じ規則を使う:
//   「本人が検証済みの要素を持つ、または所属チームが必須」なのに aal2 でないセッションは、データに触れない。
// ここは純関数だけ（ブラウザ・Edge・Node のどこでも動く）。

/** Supabase Auth の保証レベル。aal1 = パスワードや Google でログインしただけ / aal2 = 2 段階目も通した */
export type Aal = 'aal1' | 'aal2'

/** ok = そのまま通す / challenge = 認証アプリのコード入力が要る / enroll = チームが必須なのに未登録（登録が要る） */
export type MfaGate = 'ok' | 'challenge' | 'enroll'

export interface MfaGateInput {
  aal: Aal
  hasVerifiedFactor: boolean   // 本人が検証済みの要素（認証アプリ）を持っている
  requiredByTeam: boolean      // 所属チームが 2 段階認証を必須にしている
}

export function mfaGateOf(i: MfaGateInput): MfaGate {
  if (i.aal === 'aal2') return 'ok'
  if (i.hasVerifiedFactor) return 'challenge'
  if (i.requiredByTeam) return 'enroll'
  return 'ok'
}

/**
 * JWT（アクセストークン）の aal クレームを読む。読めない・無いときは aal1（Supabase の決まり: aal の無い JWT は aal1）。
 * 署名の検証はしない。トークンの正しさは、呼び出し側が Supabase Auth に問い合わせて確かめた後で使うこと。
 */
export function aalOfJwt(token: string | null | undefined): Aal {
  try {
    const part = (token ?? '').split('.')[1]
    if (!part) return 'aal1'
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { aal?: unknown }
    return payload?.aal === 'aal2' ? 'aal2' : 'aal1'
  } catch {
    return 'aal1'
  }
}

/** Supabase Auth の user.factors から、検証済みの要素があるか */
export function hasVerifiedFactor(factors: ReadonlyArray<{ status?: string | null } | null | undefined> | null | undefined): boolean {
  return Array.isArray(factors) && factors.some((f) => f?.status === 'verified')
}

/** サーバーが 2 段階認証を理由に断るときの code（HTTP は 403。401 はブラウザの Basic 認証ダイアログが出るので使わない） */
export const MFA_REQUIRED_CODE = 'mfa_required'

const MFA_MESSAGES: Record<Exclude<MfaGate, 'ok'>, string> = {
  challenge: '2 段階認証のコード入力が必要です。画面を読み込み直して、認証アプリのコードを入力してください',
  enroll: 'このチームは 2 段階認証が必須です。画面を読み込み直して、認証アプリを登録してください',
}

/** 403 の本文。error は画面にそのまま出せる文、code と gate で機械的に判定できる */
export function mfaRequiredBody(gate: Exclude<MfaGate, 'ok'>): { error: string; code: string; gate: Exclude<MfaGate, 'ok'> } {
  return { error: MFA_MESSAGES[gate], code: MFA_REQUIRED_CODE, gate }
}

/** サーバーの応答が「2 段階認証が必要」か（クライアントが判定を取り直す合図） */
export function isMfaRequiredResponse(status: number, body: unknown): boolean {
  return status === 403 && !!body && typeof body === 'object' && (body as { code?: unknown }).code === MFA_REQUIRED_CODE
}
