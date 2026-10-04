// 丸いトグル（右パネルの設定と同じ見た目: 32×16 のピルに白い丸）。チェックボックスの代わりに使う
import type { CSSProperties, MouseEvent } from 'react'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  label: string                 // 読み上げ用（aria-label）
  title?: string
  disabled?: boolean
  className?: string
  style?: CSSProperties
  stopPropagation?: boolean     // 親のクリック（カードの選択など）に伝えない
}

export function Switch({ checked, onChange, label, title, disabled, className, style, stopPropagation }: Props) {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) e.stopPropagation()
    onChange(!checked)
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={(e) => { if (stopPropagation) e.stopPropagation() }}
      className={`relative w-8 h-4 rounded-full transition-colors duration-150 disabled:opacity-50 shrink-0 ${className ?? ''}`}
      style={{ background: checked ? 'var(--accent)' : 'var(--border-active)', ...style }}
    >
      <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-150" style={{ left: checked ? '18px' : '2px' }} />
    </button>
  )
}
