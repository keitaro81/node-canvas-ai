// 「テンプレートから作成」（2026-10-31・設計 §8）: ノードが組み済みのテンプレートを選んで新しいワークフローにする
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, FilmSlate, TShirt, X } from '@phosphor-icons/react'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '../../lib/templates'

interface Props { open: boolean; busy: boolean; onClose: () => void; onPick: (t: WorkflowTemplate) => void }

export function TemplatePickerDialog({ open, busy, onClose, onPick }: Props) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, busy, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" className="w-[560px] max-w-[92vw] rounded-xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>テンプレートから作成</h2>
          <button onClick={onClose} disabled={busy} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] disabled:opacity-40" style={{ color: 'var(--text-secondary)' }} title="閉じる"><X size={14} /></button>
        </div>
        <p className="text-[12px] mt-1 mb-3" style={{ color: 'var(--text-secondary)' }}>必要なノードが組まれた状態で新しいワークフローを作ります。作った後は自由に組み替えられます。</p>
        <div className="flex flex-col gap-2">
          {WORKFLOW_TEMPLATES.map((t) => (
            <button key={t.id} disabled={busy} onClick={() => onPick(t)} className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--bg-elevated)] disabled:opacity-60" style={{ border: '1px solid var(--border)' }}>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={t.kind === 'image' ? { background: 'rgba(139,92,246,0.12)', color: '#8B5CF6' } : { background: 'rgba(236,72,153,0.12)', color: '#EC4899' }}>{t.kind === 'image' ? <TShirt size={16} /> : <FilmSlate size={16} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t.description}</span>
                <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{t.summary}</span>
              </span>
              {busy && <CircleNotch size={14} className="animate-spin shrink-0 mt-1" style={{ color: 'var(--text-tertiary)' }} />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
