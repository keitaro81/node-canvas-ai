// App モードの操作可否（2026-11-08 メモ 79）。
// App は「使う」画面なので、編集権があるのに「編集する」を押していないだけ（ロックが空いている・失効している）なら操作できる扱いにし、
// 最初の操作でロックを取る（useAppOperable）。権限が無い・他の人（や自分の別タブ）が編集中のときだけ閲覧のみ。
import { holderLabel, type EditLockView } from './editLock'

export interface AppOperabilityInput {
  canEdit: boolean          // 編集権（所有者か、編集を許可されたチームのメンバー）
  lockRequired: boolean     // 保存にロックが要る（チームの編集を許可 かつ team/public）
  editing: boolean          // このタブがロックを持って編集中
  editLock: EditLockView
  hasActions: boolean       // useEditLock が開始/終了を登録済み
}

export interface AppOperability {
  /** いま操作してよい（編集中、または最初の操作でロックを取れる） */
  operable: boolean
  /** 操作の前にロックを取る必要がある（編集権あり・ロック未取得・空いている） */
  resumable: boolean
  /** 操作できない理由（operable なら null） */
  blockedReason: string | null
}

export function appOperabilityOf(s: AppOperabilityInput): AppOperability {
  const canEditNow = s.canEdit && (!s.lockRequired || s.editing)
  const lockFree = s.editLock.state === 'free' || s.editLock.state === 'stale'
  const resumable = s.canEdit && s.lockRequired && !s.editing && lockFree && s.hasActions
  if (canEditNow || resumable) return { operable: true, resumable, blockedReason: null }
  if (!s.canEdit) return { operable: false, resumable: false, blockedReason: '閲覧のみ（操作できるのは作成者か、編集を許可されたチームのメンバーです）' }
  if (s.editLock.state === 'mine-elsewhere') return { operable: false, resumable: false, blockedReason: 'あなたの別のタブが編集中です。右上の「ここで編集」でこのタブに切り替えると操作できます' }
  if (s.editLock.state === 'held') return { operable: false, resumable: false, blockedReason: `${holderLabel(s.editLock)} が編集中のため、いまは操作できません（終わるまで待つか、90 秒更新が無ければ右上の「引き継ぐ」）` }
  return { operable: false, resumable: false, blockedReason: '編集の準備中です…' }
}
