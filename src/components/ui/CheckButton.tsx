// 共通の丸いチェックボタン（App モードの画像選択と同じ見た目: 選択中は紫の丸に白いチェック、未選択は半透明の丸に白い縁）。
// 画像の上に重ねて使う前提の配色
import type { CSSProperties, MouseEvent } from 'react'
import { Check } from 'lucide-react'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  label: string                 // 読み上げ用（aria-label）
  title?: string
  size?: number                 // 直径（px）。既定 22
  disabled?: boolean
  className?: string
  style?: CSSProperties
  stopPropagation?: boolean     // 親のクリック（カードの選択など）に伝えない
}

export function CheckButton({ checked, onChange, label, title, size = 22, disabled, className, style, stopPropagation }: Props) {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) e.stopPropagation()
    onChange(!checked)
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={(e) => { if (stopPropagation) e.stopPropagation() }}
      className={`flex items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-50 shrink-0 ${className ?? ''}`}
      style={{
        width: size, height: size,
        background: checked ? '#8B5CF6' : 'rgba(0,0,0,0.45)',
        border: checked ? 'none' : '2px solid rgba(255,255,255,0.55)',
        backdropFilter: 'blur(4px)',
        ...style,
      }}
    >
      {checked && <Check size={Math.round(size * 0.55)} color="white" strokeWidth={2.5} />}
    </button>
  )
}
