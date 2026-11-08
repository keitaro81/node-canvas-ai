// App モードの操作可否（2026-11-08 メモ 79）: 編集権があれば「編集する」を押していなくても操作でき、最初の操作（pointerdown）でロックを取る。
// 権限が無い・他の人が編集中のときは閲覧のみ（理由を title に出す）。CapsuleView と MergeAppView が使う
import { useCallback, useRef } from 'react'
import { useWorkflowStore, selectLockRequired } from '../../stores/workflowStore'
import { appOperabilityOf, type AppOperability } from '../../lib/workflow/appOperable'

export interface AppOperable extends AppOperability {
  /** いま実際に保存できる（編集中。ロック不要の WF なら編集権どおり） */
  canEditNow: boolean
  /** 左パネルの pointerdown（capture）に付ける。ロックが要るのにまだ取っていなければ取りに行く（操作自体は通す） */
  onInteract: () => void
}

export function useAppOperable(): AppOperable {
  const canEdit = useWorkflowStore((s) => s.currentWorkflowCanEdit)
  const lockRequired = useWorkflowStore(selectLockRequired)
  const editing = useWorkflowStore((s) => s.editing)
  const editLock = useWorkflowStore((s) => s.editLock)
  const editActions = useWorkflowStore((s) => s.editActions)
  const op = appOperabilityOf({ canEdit, lockRequired, editing, editLock, hasActions: !!editActions })
  const canEditNow = canEdit && (!lockRequired || editing)
  const starting = useRef(false)
  const resumable = op.resumable
  const onInteract = useCallback(() => {
    if (!resumable || starting.current || !editActions) return
    starting.current = true
    void editActions.start().finally(() => { starting.current = false })
  }, [resumable, editActions])
  return { ...op, canEditNow, onInteract }
}
