// 生成物（generations）のチーム共有（2026-11-08 メモ 75・migration 0022）。
// ライブラリに並べるのは「自分のもの」と「visibility = 'team' で共有されたもの」。ワークフロー単位の共有（0009）だけで
// 見える他人の private な生成物は、ライブラリには出さない（そのワークフローを開いて見る）。
export type LibraryScope = 'all' | 'mine' | 'team'
export interface GenerationLike { user_id?: string | null; visibility?: string | null }

/** ライブラリに並べる生成物か（自分のもの、またはチーム共有） */
export const isOwnOrTeamShared = (g: GenerationLike, myId: string | null): boolean => (!!myId && g.user_id === myId) || g.visibility === 'team'

/** 絞り込み: すべて / 自分 / チーム共有（自分以外の人のもの） */
export const generationInScope = (g: GenerationLike, scope: LibraryScope, myId: string | null): boolean =>
  scope === 'all' ? true : scope === 'mine' ? g.user_id === myId : g.user_id !== myId
