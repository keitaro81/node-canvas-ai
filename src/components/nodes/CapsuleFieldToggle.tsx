import type { CapsuleVisibility } from '../../types/nodes'

interface CapsuleFieldToggleProps {
  fieldId: string
  visibility: CapsuleVisibility
  onChange: (fieldId: string, visibility: CapsuleVisibility) => void
}

const CYCLE: CapsuleVisibility[] = ['hidden', 'visible', 'editable']

const LABELS: Record<CapsuleVisibility, string> = {
  hidden: '非表示',
  visible: '表示',
  editable: '編集可',
}

const STYLES: Record<CapsuleVisibility, React.CSSProperties> = {
  hidden:   { background: '#18181B', color: '#52525B', border: '1px solid #27272A' },
  visible:  { background: '#1E3A5F', color: '#93C5FD', border: '1px solid #1D4ED8' },
  editable: { background: '#4C1D95', color: '#C4B5FD', border: '1px solid #7C3AED' },
}

export function CapsuleFieldToggle({ fieldId, visibility, onChange }: CapsuleFieldToggleProps) {
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    const next = CYCLE[(CYCLE.indexOf(visibility) + 1) % CYCLE.length]
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
