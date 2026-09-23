import { useState, type ReactNode } from 'react'
import { CTRL, INPUT_STYLE } from './styles'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] font-medium text-[var(--text-secondary)] mb-1">{label}</div>
      {children}
    </div>
  )
}

/** 数値入力。入力中の文字列はローカルに持つ（範囲外の途中値で丸められない）。範囲内なら即反映、確定は blur / Enter。 */
export function Num({ value, min, max, step, onChange, title, placeholder }: {
  value: number | null; min?: number; max?: number; step?: number; onChange: (v: number | null) => void; title?: string; placeholder?: string
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value === null ? '' : String(value)) }
  const inRange = (n: number) => Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)
  const commit = () => {
    if (draft.trim() === '') { if (value !== null) onChange(null); return }
    const n = Number(draft)
    if (!Number.isFinite(n)) { setDraft(value === null ? '' : String(value)); return }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }
  return (
    <input
      type="number"
      className={`${CTRL} w-full tabular-nums`}
      style={INPUT_STYLE}
      value={draft}
      min={min}
      max={max}
      step={step ?? 1}
      title={title}
      placeholder={placeholder}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && inRange(n) && n !== value) onChange(n) }}
      onBlur={commit}
    />
  )
}

export function Sel<T extends string>({ value, options, onChange, disabled }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <select className={`${CTRL} w-full`} style={INPUT_STYLE} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

/**
 * テキスト入力。入力中の文字列はローカルに持つ（全部消しても既定値に戻らない）。
 * 空でない間は即反映、空のまま欄を離れたら直前の有効な値に戻す。
 */
export function TextField({ value, onChange, placeholder, mono, title }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; title?: string
}) {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value) }
  return (
    <input
      type="text"
      className={`${CTRL} w-full${mono ? ' font-mono' : ''}`}
      style={INPUT_STYLE}
      value={draft}
      placeholder={placeholder}
      title={title}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      onChange={(e) => { setDraft(e.target.value); if (e.target.value.trim() && e.target.value !== value) onChange(e.target.value) }}
      onBlur={() => { if (!draft.trim()) setDraft(value) }}
    />
  )
}

/** スライダー（値の表示つき） */
export function Range({ label, value, min, max, unit, disabled, accent, onChange }: {
  label: string; value: number; min: number; max: number; unit?: string; disabled?: boolean; accent?: string; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="text-[11px] text-[var(--text-primary)] tabular-nums">{value}{unit ?? ''}</span>
      </div>
      <input
        type="range" min={min} max={max} step={1} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full nodrag nopan"
        style={{ accentColor: accent ?? '#14B8A6' }}
      />
    </div>
  )
}
