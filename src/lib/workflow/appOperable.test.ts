import { describe, it, expect } from 'vitest'
import { appOperabilityOf } from './appOperable'
import { FREE_LOCK, type EditLockView } from './editLock'

const lock = (state: EditLockView['state'], email: string | null = 'taro@example.com'): EditLockView => ({ state, holderUserId: state === 'free' ? null : 'u2', holderEmail: email, staleAt: state === 'free' ? null : Date.now() + 60_000 })

describe('App モードの操作可否（2026-11-08 メモ 79: 編集権があれば「編集する」を押していなくても操作できる）', () => {
  it('ロック不要（自分だけの WF）は編集権どおり', () => {
    expect(appOperabilityOf({ canEdit: true, lockRequired: false, editing: true, editLock: FREE_LOCK, hasActions: false })).toEqual({ operable: true, resumable: false, blockedReason: null })
    expect(appOperabilityOf({ canEdit: false, lockRequired: false, editing: false, editLock: FREE_LOCK, hasActions: false }).blockedReason).toContain('閲覧のみ')
  })
  it('ロックが要る WF: 空いている（または失効）なら操作できる扱いで、最初の操作でロックを取る（resumable）', () => {
    expect(appOperabilityOf({ canEdit: true, lockRequired: true, editing: false, editLock: FREE_LOCK, hasActions: true })).toEqual({ operable: true, resumable: true, blockedReason: null })
    expect(appOperabilityOf({ canEdit: true, lockRequired: true, editing: false, editLock: lock('stale'), hasActions: true }).resumable).toBe(true)
    // 編集中なら取り直しは要らない
    expect(appOperabilityOf({ canEdit: true, lockRequired: true, editing: true, editLock: lock('mine'), hasActions: true })).toEqual({ operable: true, resumable: false, blockedReason: null })
    // useEditLock がまだ登録していなければ待つ
    expect(appOperabilityOf({ canEdit: true, lockRequired: true, editing: false, editLock: FREE_LOCK, hasActions: false })).toEqual({ operable: false, resumable: false, blockedReason: '編集の準備中です…' })
  })
  it('他の人・自分の別タブが編集中、または権限が無いときは閲覧のみ（理由つき）', () => {
    expect(appOperabilityOf({ canEdit: true, lockRequired: true, editing: false, editLock: lock('held'), hasActions: true }).blockedReason).toBe('taro@example.com が編集中のため、いまは操作できません（終わるまで待つか、90 秒更新が無ければ右上の「引き継ぐ」）')
    expect(appOperabilityOf({ canEdit: true, lockRequired: true, editing: false, editLock: lock('held', null), hasActions: true }).blockedReason).toContain('他のメンバー が編集中')
    expect(appOperabilityOf({ canEdit: true, lockRequired: true, editing: false, editLock: lock('mine-elsewhere'), hasActions: true }).blockedReason).toContain('別のタブ')
    expect(appOperabilityOf({ canEdit: false, lockRequired: true, editing: false, editLock: FREE_LOCK, hasActions: true })).toEqual({ operable: false, resumable: false, blockedReason: '閲覧のみ（操作できるのは作成者か、編集を許可されたチームのメンバーです）' })
  })
})
