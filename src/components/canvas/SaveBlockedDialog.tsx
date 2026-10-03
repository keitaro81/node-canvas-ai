import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { CircleNotch } from '@phosphor-icons/react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { holderLabel } from '../../lib/workflow/editLock'
import { showToast } from '../../hooks/useToast'

/** 保存できなかったとき（衝突・ロック切れ・権限なし）に、上書きせずどうするかを選んでもらう */
export function SaveBlockedDialog() {
  const navigate = useNavigate()
  const saveBlocked = useWorkflowStore((s) => s.saveBlocked)
  const editLock = useWorkflowStore((s) => s.editLock)
  const editActions = useWorkflowStore((s) => s.editActions)
  const [busy, setBusy] = useState<'reload' | 'copy' | 'resume' | null>(null)
  if (!saveBlocked) return null

  const store = useWorkflowStore.getState
  const reload = async () => {
    setBusy('reload')
    try { const id = store().currentWorkflowId; if (id) await store().loadWorkflow(id) } finally { setBusy(null); store().clearSaveBlocked() }
  }
  const copy = async () => {
    setBusy('copy')
    try {
      const newId = await store().saveCopyOfCurrent()
      store().clearSaveBlocked()
      showToast('自分のワークフローとしてコピーを保存しました', 'success')
      navigate(`/canvas/${newId}`)
    } catch { showToast('コピーの保存に失敗しました', 'error') } finally { setBusy(null) }
  }
  const resume = async () => {
    setBusy('resume')
    try {
      const ok = editActions ? await editActions.start() : false
      if (ok) { store().clearSaveBlocked(); await store().saveCurrentWorkflow() }
    } finally { setBusy(null) }
  }

  const who = editLock.state === 'held' || editLock.state === 'stale' ? holderLabel(editLock) : null
  const title = saveBlocked.kind === 'conflict' ? '他の人がこのワークフローを保存しました'
    : saveBlocked.kind === 'lock' ? '編集ロックが切れたため保存できませんでした'
    : 'このワークフローを編集する権限がありません'
  const body = saveBlocked.kind === 'conflict'
    ? 'この画面で読み込んだ後に、他の人（または別の画面）が保存しています。そのまま保存すると相手の変更を上書きしてしまうため、保存を止めました。'
    : saveBlocked.kind === 'lock'
      ? `${who ? `${who} が編集中です。` : ''}この画面の変更はまだ保存されていません。編集を再開できれば保存し直します。できなければコピーとして保存できます。`
      : 'この画面の変更は保存されていません。コピーとして自分のワークフローに保存できます。'
  const btn = 'px-3 h-8 rounded-lg text-[12px] transition-colors disabled:opacity-60 flex items-center gap-1.5'

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div role="dialog" aria-modal="true" className="w-[480px] max-w-[92vw] rounded-xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <p className="text-[12px] mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <button onClick={reload} disabled={busy !== null} className={`${btn} hover:bg-[var(--bg-elevated)]`} style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>
            {busy === 'reload' && <CircleNotch size={12} className="animate-spin" />}
            読み直す（この画面の変更は破棄）
          </button>
          <button onClick={copy} disabled={busy !== null} className={`${btn} hover:bg-[var(--bg-elevated)]`} style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>
            {busy === 'copy' && <CircleNotch size={12} className="animate-spin" />}
            自分の変更をコピーとして保存
          </button>
          {saveBlocked.kind === 'lock' && editActions && (
            <button onClick={resume} disabled={busy !== null} className={`${btn} font-medium text-white`} style={{ background: 'var(--accent)' }}>
              {busy === 'resume' && <CircleNotch size={12} className="animate-spin" />}
              編集を再開して保存
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
