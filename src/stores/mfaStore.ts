// 2 段階認証の判定（画面側・2026-11-14）。AuthGuard がこれを見て「コード入力」か「登録」の画面を出す。
// 規則は src/lib/auth/mfaGate.ts（Edge・DB と同じ）。ここは「いまのセッションがどの状態か」を持つだけで、
// 強制そのものはサーバー側（この判定を書き換えても、データには触れない）。
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { aalOfJwt, hasVerifiedFactor, mfaGateOf, type Aal, type MfaGate } from '../lib/auth/mfaGate'
import { onMfaRequired } from '../lib/auth/mfaSignal'
import { fetchRequiredByTeam, listVerifiedFactors, type MfaFactor } from '../lib/api/mfa'

/** unknown = まだ判定していない（ログイン直後の一瞬）。それ以外は mfaGateOf の結果 */
export type MfaStatus = 'unknown' | MfaGate

interface MfaState {
  status: MfaStatus
  aal: Aal
  /** 検証済みの認証アプリ（Account の設定欄・コード入力の画面で使う） */
  factors: MfaFactor[]
  /** 所属チームが必須にしている */
  requiredByTeam: boolean
  /** セッションと Auth サーバーから取り直す。force = 直近に取り直していても必ず問い合わせる */
  refresh: (force?: boolean) => Promise<void>
  /** ログアウト時 */
  reset: () => void
}

// 「チームが必須か」は端末に覚えておき、次に開いたときの最初の判定に使う（毎回の問い合わせ待ちで画面を止めない）。
// 覚えているのは表示を速くするためだけ。値を書き換えても、サーバー側の強制は変わらない。
const REQUIRED_KEY = (userId: string) => `mfa:required:${userId}`
function readCachedRequired(userId: string): boolean | null {
  try {
    const v = localStorage.getItem(REQUIRED_KEY(userId))
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}
function writeCachedRequired(userId: string, value: boolean): void {
  try { localStorage.setItem(REQUIRED_KEY(userId), value ? '1' : '0') } catch { /* 覚えられなくてもよい */ }
}

const FRESH_MS = 30_000   // この間は、同じセッション・同じ保証レベルなら問い合わせ直さない（タブに戻るたびの連打を避ける）
let seq = 0
let lastDone: { userId: string; aal: Aal; at: number } | null = null
// 取り直しが重なったら 1 回にまとめる（起動時は initialize・認証イベント・設定欄がほぼ同時に呼ぶ）。
// 走っている間に「必ず問い合わせる」依頼が来たら、終わった後にもう 1 回だけ走らせる（操作の直後の状態を取りこぼさない）
let inFlight: Promise<void> | null = null
let rerunForced = false

export const useMfaStore = create<MfaState>((set, get) => ({
  status: 'unknown',
  aal: 'aal1',
  factors: [],
  requiredByTeam: false,

  refresh: (force = false) => {
    if (inFlight) {
      if (force) rerunForced = true
      return inFlight
    }
    inFlight = refreshOnce(force, set, get).finally(() => {
      inFlight = null
      if (rerunForced) { rerunForced = false; void get().refresh(true) }
    })
    return inFlight
  },

  reset: () => {
    seq++
    lastDone = null
    rerunForced = false
    set({ status: 'unknown', aal: 'aal1', factors: [], requiredByTeam: false })
  },
}))

type SetState = (partial: Partial<MfaState>) => void

// サーバーの答えをこれ以上は待たない。通信が詰まっても「読み込み中」のまま止めず、手元の値で決める（強制はサーバー側にある）
const SERVER_WAIT_MS = 8_000
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

async function refreshOnce(force: boolean, set: SetState, get: () => MfaState): Promise<void> {
  let session = null
  try { session = (await supabase.auth.getSession()).data.session } catch { /* 下で未ログイン扱い */ }
  if (!session) { get().reset(); return }
  const userId = session.user.id
  const aal = aalOfJwt(session.access_token)
  if (!force && lastDone && lastDone.userId === userId && lastDone.aal === aal && Date.now() - lastDone.at < FRESH_MS && get().status !== 'unknown') return
  const my = ++seq

  // まず手元の情報で決められるなら決める（aal2 は確定。aal1 は「要素あり → コード入力」「前回は必須でなかった → 通す」）
  const cachedRequired = readCachedRequired(userId)
  const localHasFactor = hasVerifiedFactor(session.user.factors)
  if (get().status === 'unknown') {
    if (aal === 'aal2') set({ status: 'ok', aal })
    else if (localHasFactor) set({ status: 'challenge', aal })
    else if (cachedRequired === false) set({ status: 'ok', aal })
    // それ以外（この端末で初めて・前回は必須だった）は、サーバーの答えを待つ
  }

  // サーバーに確かめる（他の端末での登録・リセット、オーナーによる必須の切り替えを反映する）。
  // 通信に失敗しても「判定できないまま」で止めない: 手元の値で決める（強制はサーバー側にあるので、画面は通してよい）
  let factors: MfaFactor[] | null = null
  let required: boolean | null = null
  let latestAal = aal
  try {
    const [f, r] = await withTimeout(Promise.all([
      listVerifiedFactors().catch(() => null),   // 取れなければ手元の値で続ける
      fetchRequiredByTeam(),
    ]), SERVER_WAIT_MS)
    factors = f
    required = r
    if (required !== null) writeCachedRequired(userId, required)
    // 問い合わせの間に保証レベルが変わっていることがある（コード入力の直後など）ので、最新のトークンで決める
    const latest = (await supabase.auth.getSession()).data.session
    if (!latest) { if (my === seq) get().reset(); return }
    latestAal = aalOfJwt(latest.access_token)
  } catch {
    // 下で手元の値から決める
  }
  if (my !== seq) return   // もっと新しい取り直しが走っている

  const requiredByTeam = required ?? cachedRequired ?? false
  const hasFactor = factors ? factors.length > 0 : localHasFactor
  set({
    status: mfaGateOf({ aal: latestAal, hasVerifiedFactor: hasFactor, requiredByTeam }),
    aal: latestAal,
    factors: factors ?? get().factors,
    requiredByTeam,
  })
  lastDone = { userId, aal: latestAal, at: Date.now() }
}

// サーバーが「2 段階認証が必要」と断ったら、判定を取り直す（他の端末で登録した・必須に切り替わった など）
onMfaRequired(() => { void useMfaStore.getState().refresh(true) })
