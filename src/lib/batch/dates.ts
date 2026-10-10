// JST の日付計算（サーバー api/batch と クライアントの共有。純関数）。
const JST_MS = 9 * 60 * 60 * 1000

/** JST の「今日」の範囲（UTC の ISO）と日付キー。 */
export function jstDayRangeUtc(now: Date = new Date()): { start: string; end: string; day: string } {
  const j = new Date(now.getTime() + JST_MS)
  const dayStartUtcMs = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - JST_MS
  return {
    start: new Date(dayStartUtcMs).toISOString(),
    end: new Date(dayStartUtcMs + 24 * 60 * 60 * 1000).toISOString(),
    day: new Date(dayStartUtcMs + JST_MS).toISOString().slice(0, 10),
  }
}

/** 'YYYY-MM-DD'（JST）の 1 日の範囲（UTC の ISO）。不正な文字列なら null。 */
export function jstDayBounds(dateStr: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const startMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - JST_MS
  if (!Number.isFinite(startMs)) return null
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 24 * 60 * 60 * 1000).toISOString() }
}

/** 'YYYY-MM-DD HH:mm'（JST） */
export function jstDateTimeLabel(now: Date = new Date()): string {
  const j = new Date(now.getTime() + JST_MS)
  return `${j.toISOString().slice(0, 10)} ${j.toISOString().slice(11, 16)}`
}

/** ISO 文字列 → 'YYYY-MM-DD HH:mm'（JST）。不正なら '' */
export function formatJst(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : jstDateTimeLabel(d)
}

/** 相対表示（日本語）: 'たった今' / 'n分前' / 'n時間前' / 'n日前'。30 日以上前は 'YYYY-MM-DD'。不正なら '' */
export function formatRelativeJa(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.floor(Math.max(0, now - t) / 60000)
  if (mins < 1) return 'たった今'
  if (mins < 60) return `${mins}分前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}日前`
  return jstDateTimeLabel(new Date(t)).slice(0, 10)
}
