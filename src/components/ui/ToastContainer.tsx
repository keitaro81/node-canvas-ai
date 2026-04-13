import { createPortal } from 'react-dom'
import { X, AlertTriangle, Info, AlertCircle } from 'lucide-react'
import { useToast } from '../../hooks/useToast'

export function ToastContainer() {
  const { items, dismiss } = useToast()
  if (items.length === 0) return null

  return createPortal(
    <div
      className="fixed flex flex-col gap-2"
      style={{ bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 99999, minWidth: 280, maxWidth: 480 }}
    >
      {items.map((toast) => {
        const isWarning = toast.type === 'warning'
        const isError = toast.type === 'error'
        const Icon = isError ? AlertCircle : isWarning ? AlertTriangle : Info
        const color = isError ? '#EF4444' : isWarning ? '#F59E0B' : '#8B5CF6'
        const bg = isError ? 'rgba(239,68,68,0.12)' : isWarning ? 'rgba(245,158,11,0.12)' : 'rgba(139,92,246,0.12)'

        return (
          <div
            key={toast.id}
            className="flex items-start gap-3 px-4 py-3 rounded-xl"
            style={{
              background: 'var(--bg-surface)',
              border: `1px solid ${color}40`,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              animation: 'node-popin 0.15s ease-out',
            }}
          >
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: bg }}
            >
              <Icon size={13} style={{ color }} />
            </div>
            <span className="flex-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {toast.message}
            </span>
            <button
              className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 rounded transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onClick={() => dismiss(toast.id)}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
