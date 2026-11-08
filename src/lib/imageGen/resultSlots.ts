// Image Generation の結果ノード（Result）の割り当て（2026-11-08 メモ 81）。
// チャットやテンプレートが先に置いた空の Result（まだ結果が入っていない・エラーでも取得中でもない）があれば、生成でまずそこを埋め、
// 足りない分だけ新しく作る。これで「Image Generation → Result → 次のノード」とつないだ形が、1 回目の生成からそのまま動く
export interface ResultNodeLike {
  id: string
  position: { y: number }
  data: Record<string, unknown>
}

/** まだ結果が入っていない Result か（置いただけ。生成中・エラー・結果ありは対象外） */
export function isEmptyResult(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false
  const status = data.status
  if (status !== undefined && status !== null && status !== 'idle') return false
  if (typeof data.output === 'string' && data.output) return false
  if (data.requestId) return false
  return true
}

/** 生成 count 枚ぶんの Result の割り当て: 再利用する id（上から順）と、新しく作る枚数 */
export function planResultSlots(existing: ResultNodeLike[], count: number): { reuseIds: string[]; createCount: number } {
  const n = Math.max(0, Math.floor(count))
  const empties = existing.filter((d) => isEmptyResult(d.data)).sort((a, b) => a.position.y - b.position.y)
  const reuseIds = empties.slice(0, n).map((d) => d.id)
  return { reuseIds, createCount: n - reuseIds.length }
}
