import type { CapsuleVisibility } from '../../types/nodes'

interface CapsuleFieldToggleProps {
  fieldId: string
  visibility: CapsuleVisibility
  onChange: (fieldId: string, visibility: CapsuleVisibility) => void
}

const CYCLE: CapsuleVisibility[] = ['hidden', 'visible']

const LABELS: Record<CapsuleVisibility, string> = {
  hidden: '非表示',
  visible: '表示',
  editable: '表示',
}

const STYLES: Record<CapsuleVisibility, React.CSSProperties> = {
  hidden:   { background: 'var(--bg-panel)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' },
  visible:  { background: 'var(--border-active)', color: 'white', border: '1px solid var(--border-active)' },
  editable: { background: 'var(--border-active)', color: 'white', border: '1px solid var(--border-active)' },
}

export function CapsuleFieldToggle({ fieldId, visibility, onChange }: CapsuleFieldToggleProps) {
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    // editable (legacy) → treat as visible for cycling
    const current = visibility === 'editable' ? 'visible' : visibility
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
    onChange(fieldId, next)
  }

  return (
    <button
      className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all nodrag"
      style={STYLES[visibility]}
      onClick={handleClick}
      title={`Capsule: ${LABELS[visibility]} (クリックで切替)`}
    >
      {LABELS[visibility]}
    </button>
  )
}
