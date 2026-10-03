// 編集ロック（フェーズ B）の純関数と既定値。ワークフローの「チームの編集を許可」が ON のとき、
// 保存にはロックの保持が必要（サーバーの 0017 トリガが保証）。ここは画面表示と自動解除の判定だけを担う。

export const LOCK_HEARTBEAT_MS = 20_000              // ロックの更新間隔
export const LOCK_STALE_MS = 90_000                  // この時間更新が無ければ失効（引き継ぎ可）。サーバーの 90 秒と合わせる
export const LOCK_IDLE_RELEASE_MS = 10 * 60_000      // 無操作でロックを手放す
export const LOCK_HIDDEN_RELEASE_MS = 5 * 60_000     // タブを隠したままでロックを手放す
export const VIEWER_POLL_MS = 20_000                 // 閲覧側が更新を確かめる間隔

export interface EditLockRow {
  workflow_id: string
  user_id: string
  user_email: string | null
  session_id: string
  acquired_at: string
  heartbeat_at: string
}

/** free=誰も持っていない / mine=このタブが持っている / mine-elsewhere=自分の別タブ / held=他の人（有効） / stale=失効（引き継げる） */
export type EditLockState = 'free' | 'mine' | 'mine-elsewhere' | 'held' | 'stale'

export interface EditLockView {
  state: EditLockState
  holderUserId: string | null
  holderEmail: string | null
  staleAt: number | null        // 失効する時刻（epoch ms）。free のとき null
}

export const FREE_LOCK: EditLockView = { state: 'free', holderUserId: null, holderEmail: null, staleAt: null }

/** ロック行から表示状態を決める */
export function lockViewOf(row: EditLockRow | null | undefined, me: string | null, sessionId: string, now = Date.now(), staleMs = LOCK_STALE_MS): EditLockView {
  if (!row) return FREE_LOCK
  const hb = Date.parse(row.heartbeat_at)
  const staleAt = Number.isFinite(hb) ? hb + staleMs : null
  const base = { holderUserId: row.user_id, holderEmail: row.user_email ?? null, staleAt }
  if (staleAt !== null && staleAt <= now) return { state: 'stale', ...base }
  if (me && row.user_id === me) return { state: row.session_id === sessionId ? 'mine' : 'mine-elsewhere', ...base }
  return { state: 'held', ...base }
}

/** acquire_workflow_edit_lock の戻り値 */
export interface AcquireResult {
  ok: boolean
  reason?: 'held' | 'forbidden' | 'free'
  holder_user_id?: string | null
  holder_email?: string | null
  session_id?: string | null
  same_user?: boolean
  took_over?: boolean
  heartbeat_at?: string | null
  stale_at?: string | null
}

/** RPC の戻り値から表示状態を決める（取得できたら mine、他が持っていれば held / mine-elsewhere） */
export function lockViewFromAcquire(r: AcquireResult | null | undefined, me: string | null, sessionId: string, now = Date.now()): EditLockView {
  if (!r) return FREE_LOCK
  const staleAt = r.stale_at ? Date.parse(r.stale_at) : null
  if (r.ok) return { state: 'mine', holderUserId: me, holderEmail: r.holder_email ?? null, staleAt }
  if (r.reason === 'held') {
    const row: EditLockRow = { workflow_id: '', user_id: r.holder_user_id ?? '', user_email: r.holder_email ?? null, session_id: r.session_id ?? '', acquired_at: '', heartbeat_at: r.heartbeat_at ?? '' }
    return lockViewOf(row, me, sessionId, now)
  }
  return FREE_LOCK
}

/** 「チームの編集を許可」が効いている＝保存にロックが要る */
export function lockRequiredFor(w: { team_edit?: boolean | null; visibility?: string | null } | null | undefined): boolean {
  return !!w?.team_edit && (w.visibility === 'team' || w.visibility === 'public')
}

/** 無操作・タブ非表示による自動解除。戻り値は理由（解除しないなら null） */
export function autoReleaseReason(now: number, lastActivityAt: number, hiddenSince: number | null,
  idleMs = LOCK_IDLE_RELEASE_MS, hiddenMs = LOCK_HIDDEN_RELEASE_MS): 'idle' | 'hidden' | null {
  if (hiddenSince !== null && now - hiddenSince >= hiddenMs) return 'hidden'
  if (now - lastActivityAt >= idleMs) return 'idle'
  return null
}

/** 表示名（メールのローカル部）。無ければ「他のメンバー」 */
export function holderLabel(view: Pick<EditLockView, 'holderEmail'>): string {
  const e = view.holderEmail
  if (!e) return '他のメンバー'
  return e
}

/** 保存エラーの分類（0017 のトリガ/ポリシーが返すメッセージ） */
export type SaveErrorKind = 'lock' | 'settings' | 'forbidden' | 'other'
export function classifySaveError(e: unknown): SaveErrorKind {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '')
  if (msg.includes('workflow_edit_lock_required')) return 'lock'
  if (msg.includes('shared_edit_settings_forbidden')) return 'settings'
  if (/row-level security|permission denied|42501/i.test(msg)) return 'forbidden'
  return 'other'
}

/** タブごとのセッション ID（再読込しても同じタブなら同じ値＝自分のロックを引き継げる） */
export function editSessionId(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null, random: () => string): string {
  const KEY = 'wf-edit-session'
  try {
    const cur = storage?.getItem(KEY)
    if (cur) return cur
    const next = random()
    storage?.setItem(KEY, next)
    return next
  } catch {
    return random()
  }
}
