// 2 段階認証（認証アプリ・TOTP）の API（2026-11-14・設計 docs/specs/two-factor-auth.md）。
// Supabase Auth 標準の MFA をそのまま使う。強制はサーバー側（DB の mfa_gate ポリシーと Edge の確認）。
import { supabase } from '../supabase'

export interface MfaFactor {
  id: string
  name: string
  createdAt: string
}

export interface TotpEnrollment {
  factorId: string
  qr: string       // QR コード（data URL の SVG。<img src> にそのまま入れる）
  secret: string   // QR を読めないときに手で入れるキー
}

const ISSUER = 'Node Canvas AI'   // 認証アプリに表示される発行元

/** 検証済みの認証アプリの一覧。Auth サーバーに問い合わせる（他の端末での登録・削除も反映される） */
export async function listVerifiedFactors(): Promise<MfaFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return (data?.totp ?? []).map((f) => ({ id: f.id, name: f.friendly_name || '認証アプリ', createdAt: f.created_at }))
}

/** 登録の途中で放置された要素を消す（名前の重複と、上限 10 個を避ける） */
async function dropUnverifiedFactors(): Promise<void> {
  const { data } = await supabase.auth.mfa.listFactors()
  for (const f of data?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
}

/** 登録を始める: QR コードとキーを受け取る（この時点ではまだ有効にならない） */
export async function startTotpEnroll(friendlyName: string): Promise<TotpEnrollment> {
  await dropUnverifiedFactors()
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName, issuer: ISSUER })
  if (error) throw error
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

/** 6 桁のコードを確かめる（登録の確認にも、ログイン後のコード入力にも使う）。成功するとこのセッションは aal2 になる */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) throw error
}

/** 登録をやめる（確認前の要素を消す） */
export async function cancelTotpEnroll(factorId: string): Promise<void> {
  await supabase.auth.mfa.unenroll({ factorId })
}

/** 登録済みの認証アプリを消す（本人が 2 段階目を通したセッションでだけできる）。消したらトークンを取り直す */
export async function removeFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
  await supabase.auth.refreshSession()
}

// mfa_status が無い環境（マイグレーション 0023 が未適用）では、このページを開いている間は問い合わせ直さない（404 を繰り返さない）
let statusRpcMissing = false

/** 所属チームが 2 段階認証を必須にしているか。null = 判定できない（マイグレーション 0023 が未適用・通信の失敗） */
export async function fetchRequiredByTeam(): Promise<boolean | null> {
  if (statusRpcMissing) return null
  const { data, error } = await supabase.rpc('mfa_status')
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') statusRpcMissing = true
    return null
  }
  return (data as { required_by_team?: unknown } | null)?.required_by_team === true
}

/** Supabase Auth のエラーを画面に出す文にする */
export function mfaErrorMessage(err: unknown): string {
  const e = (err ?? {}) as { code?: string; status?: number; message?: string }
  switch (e.code) {
    case 'mfa_verification_failed':
      return 'コードが違います。認証アプリに表示されている最新の 6 桁を入力してください'
    case 'mfa_challenge_expired':
      return '時間切れです。もう一度コードを入力してください'
    case 'mfa_verification_rejected':
      return 'コードの確認が拒否されました。しばらく待ってからやり直してください'
    case 'mfa_factor_name_conflict':
      return '同じ名前の認証アプリが登録されています。別の名前にしてください'
    case 'too_many_enrolled_mfa_factors':
      return '登録できる認証アプリは 10 個までです。使っていないものを削除してください'
    case 'mfa_ip_address_mismatch':
      return '登録の途中で接続元が変わりました。最初からやり直してください'
    case 'mfa_factor_not_found':
      return 'この認証アプリの登録は見つかりません。画面を読み込み直してください'
    case 'insufficient_aal':
      return 'この操作には 2 段階認証のコード入力が必要です。ログインし直して、コードを入力してください'
    case 'mfa_totp_enroll_not_enabled':
    case 'mfa_totp_verify_not_enabled':
      return '2 段階認証（認証アプリ）が、いまは使えない設定になっています。運営にお問い合わせください'
    case 'over_request_rate_limit':
      return '試行が多すぎます。1 分ほど待ってからやり直してください'
    default:
      if (e.status === 429) return '試行が多すぎます。1 分ほど待ってからやり直してください'
      return e.message || '2 段階認証の処理に失敗しました'
  }
}

/** キーを 4 文字ずつに区切る（手入力しやすく） */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}
