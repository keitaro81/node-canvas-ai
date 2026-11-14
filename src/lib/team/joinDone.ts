// 招待リンクで「参加が済んだ」印（このタブの間・10 分だけ・2026-11-14）。
// 参加の直後に 2 段階認証の登録・コード入力の画面をはさむと、招待リンクのページ（/join/:token）は開き直しになる。
// そのときに「参加しますか？」へ戻らず「参加しました」を出すために覚えておく。表示のためだけで、所属の判定には使わない。
const PREFIX = 'join:done:'
export const JOIN_DONE_TTL_MS = 10 * 60_000

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

function tabStorage(): StorageLike | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** 参加済みなら { teamName }。印が無い・古い（10 分を過ぎた）なら null */
export function readJoinDone(token: string | undefined, now: number = Date.now(), st: StorageLike | null = tabStorage()): { teamName: string | null } | null {
  if (!token || !st) return null
  try {
    const raw = st.getItem(PREFIX + token)
    if (!raw) return null
    const v = JSON.parse(raw) as { teamName?: unknown; at?: unknown }
    if (typeof v.at !== 'number' || now - v.at > JOIN_DONE_TTL_MS) return null
    return { teamName: typeof v.teamName === 'string' && v.teamName ? v.teamName : null }
  } catch {
    return null
  }
}

/** 参加が済んだ（招待リンクからの参加・アカウント作成の直後に呼ぶ） */
export function markJoinDone(token: string, teamName: string | null, now: number = Date.now(), st: StorageLike | null = tabStorage()): void {
  try { st?.setItem(PREFIX + token, JSON.stringify({ teamName, at: now })) } catch { /* 覚えられなくてもよい */ }
}

/** チームを離れたら印を捨てる（同じリンクを開き直したときに「参加しました」と出さない） */
export function clearJoinDone(st: StorageLike | null = tabStorage()): void {
  if (!st) return
  try {
    const keys: string[] = []
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i)
      if (k && k.startsWith(PREFIX)) keys.push(k)
    }
    for (const k of keys) st.removeItem(k)
  } catch {
    // 捨てられなくてもよい（10 分で切れる）
  }
}
