import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowSquareOut, ArrowsClockwise, CircleNotch, DotsThree, Prohibit, Trash } from '@phosphor-icons/react'
import type { BatchJobRow } from '../../types/batch'
import { batchCancel, batchDelete, batchRetry, submitJobFully } from '../../lib/api/batch'
import { canCancelJob, canDeleteJob, canRetryJob } from '../../lib/batch/jobsQuery'
import { useBatchStore } from '../../stores/batchStore'
import { showToast } from '../../hooks/useToast'
import { ConfirmDialog } from '../ui/ConfirmDialog'

export type JobActionKind = 'cancel' | 'retry' | 'delete'

interface Props {
  job: BatchJobRow
  showOpen?: boolean
  openTo?: string                 // 「開く」の遷移先（既定はジョブ詳細。一覧からは App で開く）
  compact?: boolean
  only?: JobActionKind[]          // 出す操作を絞る（App の「処理中」行はキャンセルだけ、「失敗」行はやり直しだけ）
  variant?: 'row' | 'menu'        // menu = 「…」ボタンで開く小さなメニュー（App / 一括結果ノードのヘッダー）
  className?: string
  onChanged?: () => void
  onDeleted?: () => void
}

type Busy = JobActionKind | null

/** 行の操作（仕様 4-11）: 開く / キャンセル / 失敗分をやり直す / 削除（実行した本人と owner のみ表示）。variant='menu' なら「…」から開く */
export function JobActions({ job, showOpen, compact, only, variant = 'row', className, onChanged, onDeleted, openTo }: Props) {
  const navigate = useNavigate()
  const userId = useBatchStore((s) => s.userId)
  const role = useBatchStore((s) => s.role)
  const bump = useBatchStore((s) => s.bump)
  const [busy, setBusy] = useState<Busy>(null)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])
  const show = (k: JobActionKind) => !only || only.includes(k)
  const canCancel = show('cancel') && canCancelJob(job)
  const canRetry = show('retry') && canRetryJob(job)
  const canDelete = show('delete') && canDeleteJob(job, userId, role)

  const btn = 'flex items-center gap-1 h-7 px-2 rounded-md text-[11px] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-50'

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
      setConfirm(null)
      bump()
      onChanged?.()
    }
  }

  const doCancel = () => run('cancel', async () => {
    const r = await batchCancel(job.id)
    showToast(r.status === 'cancelled' ? `キャンセルしました（未完了タスク ${r.cancelledTasks} 件）` : 'この処理は既に終わっています', 'info')
  })
  const doRetry = () => run('retry', async () => {
    const r = await batchRetry(job.id)
    if (!r.retriedTasks) { showToast('再実行する失敗タスクはありません', 'info'); return }
    await submitJobFully(job.id)
    showToast(`失敗した ${r.retriedTasks} 件をやり直しています`, 'success')
  })
  const doDelete = () => run('delete', async () => {
    const r = await batchDelete(job.id)
    showToast(`削除しました（ファイル ${r.deletedFiles} 件）`, 'success')
    onDeleted?.()
  })

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm === 'cancel'}
        title="処理をキャンセルしますか？"
        confirmLabel="キャンセルする"
        cancelLabel="戻る"
        busy={busy === 'cancel'}
        onConfirm={doCancel}
        onCancel={() => setConfirm(null)}
      >
        「{job.name}」の未完了の処理を fal.ai に取り消し依頼し、「キャンセル済み」にします。完了済みの結果は残ります。
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        title="この結果を削除しますか？"
        confirmLabel="削除する"
        cancelLabel="戻る"
        danger
        busy={busy === 'delete'}
        onConfirm={doDelete}
        onCancel={() => setConfirm(null)}
      >
        「{job.name}」を削除します。<b style={{ color: 'var(--text-primary)' }}>元画像・AI 処理の結果・レイアウト出力のファイルもまとめて消え、元に戻せません。</b>
        {canCancelJob(job) && ' 進行中の処理はキャンセルされます。'}
      </ConfirmDialog>
    </>
  )
  const menuItem = 'flex items-center gap-2 w-full h-8 px-3 text-left text-[12px] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-50'
  if (variant === 'menu') {
    if (!canCancel && !canRetry && !canDelete) return null
    return (
      <div ref={menuRef} className={`relative ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
        <button className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} title="この結果の操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          {busy ? <CircleNotch size={15} className="animate-spin" /> : <DotsThree size={18} weight="bold" />}
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 top-full mt-1 min-w-[180px] py-1 rounded-lg z-30" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
            {canCancel && <button role="menuitem" className={menuItem} style={{ color: 'var(--text-primary)' }} disabled={busy !== null} onClick={() => { setMenuOpen(false); setConfirm('cancel') }}><Prohibit size={13} />処理をキャンセル</button>}
            {canRetry && <button role="menuitem" className={menuItem} style={{ color: 'var(--text-primary)' }} disabled={busy !== null} onClick={() => { setMenuOpen(false); doRetry() }}><ArrowsClockwise size={13} />失敗分をやり直す</button>}
            {canDelete && <button role="menuitem" className={menuItem} style={{ color: '#EF4444' }} disabled={busy !== null} onClick={() => { setMenuOpen(false); setConfirm('delete') }}><Trash size={13} />この結果を削除</button>}
          </div>
        )}
        {dialogs}
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-0.5 ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      {showOpen && (
        <button className={btn} style={{ color: 'var(--text-secondary)' }} title="開く" onClick={() => navigate(openTo ?? `/jobs/${job.id}`)}>
          <ArrowSquareOut size={13} />{!compact && '開く'}
        </button>
      )}
      {canCancel && (
        <button className={btn} style={{ color: 'var(--text-secondary)' }} title="キャンセル" disabled={busy !== null} onClick={() => setConfirm('cancel')}>
          {busy === 'cancel' ? <CircleNotch size={13} className="animate-spin" /> : <Prohibit size={13} />}{!compact && 'キャンセル'}
        </button>
      )}
      {canRetry && (
        <button className={btn} style={{ color: '#F59E0B' }} title="失敗分をやり直す" disabled={busy !== null} onClick={doRetry}>
          {busy === 'retry' ? <CircleNotch size={13} className="animate-spin" /> : <ArrowsClockwise size={13} />}{!compact && '失敗分をやり直す'}
        </button>
      )}
      {canDelete && (
        <button className={btn} style={{ color: '#EF4444' }} title="削除" disabled={busy !== null} onClick={() => setConfirm('delete')}>
          {busy === 'delete' ? <CircleNotch size={13} className="animate-spin" /> : <Trash size={13} />}{!compact && '削除'}
        </button>
      )}

      {dialogs}
    </div>
  )
}
