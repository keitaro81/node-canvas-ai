import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch } from '@phosphor-icons/react'

interface Props {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** 確認ダイアログ（キャンセル・削除など）。busy 中は閉じられない。 */
export function ConfirmDialog({ open, title, children, confirmLabel = '実行', cancelLabel = 'キャンセル', danger, busy, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, busy, onCancel])
  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-[440px] max-w-[92vw] rounded-xl p-5"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
      >
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {children && <div className="text-[12px] mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{children}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 h-8 rounded-lg text-[12px] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-60"
            style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-3 h-8 rounded-lg text-[12px] font-medium text-white flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: danger ? '#EF4444' : 'var(--accent)' }}
          >
            {busy && <CircleNotch size={12} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
