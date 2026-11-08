import { describe, it, expect } from 'vitest'
import { generationInScope, isOwnOrTeamShared } from './generationVisibility'

describe('生成物のチーム共有（2026-11-08 メモ 75）', () => {
  const me = 'u-me'
  it('ライブラリに並ぶのは自分のものと visibility = team のもの。他人の private（WF 共有で見えるだけ）は並ばない', () => {
    expect(isOwnOrTeamShared({ user_id: me, visibility: 'private' }, me)).toBe(true)
    expect(isOwnOrTeamShared({ user_id: 'u-other', visibility: 'team' }, me)).toBe(true)
    expect(isOwnOrTeamShared({ user_id: 'u-other', visibility: 'private' }, me)).toBe(false)
    expect(isOwnOrTeamShared({ user_id: 'u-other' }, me)).toBe(false)              // 0022 未適用（列なし）は private 扱い
    expect(isOwnOrTeamShared({ user_id: me }, null)).toBe(false)                  // ログイン情報が取れていないうちは自分のものと判定できない
  })
  it('絞り込み: すべて / 自分 / チーム共有', () => {
    const mine = { user_id: me, visibility: 'team' }, theirs = { user_id: 'u-other', visibility: 'team' }
    expect(generationInScope(mine, 'all', me)).toBe(true); expect(generationInScope(theirs, 'all', me)).toBe(true)
    expect(generationInScope(mine, 'mine', me)).toBe(true); expect(generationInScope(theirs, 'mine', me)).toBe(false)
    expect(generationInScope(mine, 'team', me)).toBe(false); expect(generationInScope(theirs, 'team', me)).toBe(true)
  })
})
