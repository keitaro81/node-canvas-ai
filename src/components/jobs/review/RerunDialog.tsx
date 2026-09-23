import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch } from '@phosphor-icons/react'
import type { CutoutParams } from '../../../types/nodes'
import { CutoutParamsForm } from '../../nodes/pp/CutoutParamsForm'

interface Props {
  open: boolean
  count: number
  initial: CutoutParams
  busy: boolean
  onClose: () => void
  onConfirm: (params: CutoutParams) => void
}

/** NG のみ再実行（仕様 5 章）: エンジンとパラメータを差し替えて、NG のアイテムだけ新しいタスクを投入する */
export function RerunDialog(props: Props) {
  if (!props.open) return null
  return <RerunDialogInner {...props} />
}

function RerunDialogInner({ count, initial, busy, onClose, onConfirm }: Props) {
  const [params, setParams] = useState<CutoutParams>(initial)   // 開くたびにマウントされるので初期値で足りる
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [busy, onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" className="w-[460px] max-w-[92vw] rounded-xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>NG のみ再実行（{count} 枚）</h2>
        <p className="text-[12px] mt-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
          NG を付けたアイテムの切り抜きだけを、下の設定で fal.ai に再投入します。他のアイテムには影響しません。完了すると結果とサムネイルが差し替わり、確認結果は未確認に戻ります。
        </p>
        <CutoutParamsForm params={params} onChange={(patch) => setParams((p) => ({ ...p, ...patch }))} disabled={busy} />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={busy} className="px-3 h-8 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)] disabled:opacity-60" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>キャンセル</button>
          <button onClick={() => onConfirm(params)} disabled={busy || count === 0} className="px-4 h-8 rounded-lg text-[12px] font-medium text-white flex items-center gap-1.5 disabled:opacity-60" style={{ background: '#F59E0B' }}>
            {busy && <CircleNotch size={12} className="animate-spin" />}{count} 枚を再投入する
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
