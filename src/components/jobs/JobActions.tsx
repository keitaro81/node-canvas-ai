import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowSquareOut, ArrowsClockwise, CircleNotch, Prohibit, Trash } from '@phosphor-icons/react'
import type { BatchJobRow } from '../../types/batch'
import { batchCancel, batchDelete, batchRetry, submitJobFully } from '../../lib/api/batch'
import { canCancelJob, canDeleteJob, canRetryJob } from '../../lib/batch/jobsQuery'
import { useBatchStore } from '../../stores/batchStore'
import { showToast } from '../../hooks/useToast'
import { ConfirmDialog } from '../ui/ConfirmDialog'

interface Props {
  job: BatchJobRow
  showOpen?: boolean
  compact?: boolean
  onChanged?: () => void
  onDeleted?: () => void
}

type Busy = 'cancel' | 'retry' | 'delete' | null

/** 行の操作（仕様 4-11）: 開く / キャンセル / 失敗分を再実行 / 削除（投入者本人と owner のみ表示）。再書き出しは Step 7 で追加 */
export function JobActions({ job, showOpen, compact, onChanged, onDeleted }: Props) {
  const navigate = useNavigate()
  const userId = useBatchStore((s) => s.userId)
  const role = useBatchStore((s) => s.role)
  const bump = useBatchStore((s) => s.bump)
  const [busy, setBusy] = useState<Busy>(null)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)

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
    showToast(r.status === 'cancelled' ? `キャンセルしました（未完了タスク ${r.cancelledTasks} 件）` : 'このジョブは既に終了しています', 'info')
  })
  const doRetry = () => run('retry', async () => {
    const r = await batchRetry(job.id)
    if (!r.retriedTasks) { showToast('再実行する失敗タスクはありません', 'info'); return }
    await submitJobFully(job.id)
    showToast(`失敗した ${r.retriedTasks} 件を再投入しました`, 'success')
  })
  const doDelete = () => run('delete', async () => {
    const r = await batchDelete(job.id)
    showToast(`ジョブを削除しました（ファイル ${r.deletedFiles} 件）`, 'success')
    onDeleted?.()
  })

  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {showOpen && (
        <button className={btn} style={{ color: 'var(--text-secondary)' }} title="開く" onClick={() => navigate(`/jobs/${job.id}`)}>
          <ArrowSquareOut size={13} />{!compact && '開く'}
        </button>
      )}
      {canCancelJob(job) && (
        <button className={btn} style={{ color: 'var(--text-secondary)' }} title="キャンセル" disabled={busy !== null} onClick={() => setConfirm('cancel')}>
          {busy === 'cancel' ? <CircleNotch size={13} className="animate-spin" /> : <Prohibit size={13} />}{!compact && 'キャンセル'}
        </button>
      )}
      {canRetryJob(job) && (
        <button className={btn} style={{ color: '#F59E0B' }} title="失敗分を再実行" disabled={busy !== null} onClick={doRetry}>
          {busy === 'retry' ? <CircleNotch size={13} className="animate-spin" /> : <ArrowsClockwise size={13} />}{!compact && '失敗分を再実行'}
        </button>
      )}
      {canDeleteJob(job, userId, role) && (
        <button className={btn} style={{ color: '#EF4444' }} title="削除" disabled={busy !== null} onClick={() => setConfirm('delete')}>
          {busy === 'delete' ? <CircleNotch size={13} className="animate-spin" /> : <Trash size={13} />}{!compact && '削除'}
        </button>
      )}

      <ConfirmDialog
        open={confirm === 'cancel'}
        title="ジョブをキャンセルしますか？"
        confirmLabel="キャンセルする"
        cancelLabel="戻る"
        busy={busy === 'cancel'}
        onConfirm={doCancel}
        onCancel={() => setConfirm(null)}
      >
        「{job.name}」の未完了の処理を fal.ai に取り消し依頼し、ジョブを「キャンセル済み」にします。完了済みの結果は残ります。
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        title="ジョブを削除しますか？"
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
    </div>
  )
}
