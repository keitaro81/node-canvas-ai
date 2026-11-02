// ファイル名の付け方（2026-11-02 メモ 43）: 記号（{sku} など）を書かせず、名前の型を一覧から選び、必要なら部品を並べて組む。
// Lightroom の「名前の型＋部品」と Adobe Bridge の一括リネームを参考にした。保存は今までどおり記号の文字列（namePattern）
import { useState } from 'react'
import { X } from 'lucide-react'
import { NAME_PRESETS, appendNamePart, buildNamePattern, namePartLabel, parseNamePattern, presetIdOf, removeNamePart, type NamePart } from '../../../lib/export/naming'
import { PP_ACCENT, stopKeys } from './styles'

const ADD_OPTIONS: Array<{ value: string; label: string; part: NamePart }> = [
  { value: 'sku', label: '商品名', part: { kind: 'sku' } },
  { value: 'original', label: '元のファイル名', part: { kind: 'original' } },
  { value: 'variant', label: 'バリアント', part: { kind: 'variant' } },
  { value: 'index2', label: '連番 2 桁（01）', part: { kind: 'index', pad: 2 } },
  { value: 'index3', label: '連番 3 桁（001）', part: { kind: 'index', pad: 3 } },
  { value: 'index', label: '連番（1）', part: { kind: 'index', pad: 0 } },
  { value: 'date', label: '日付（20261102）', part: { kind: 'date' } },
  { value: 'text', label: '文字', part: { kind: 'text', text: '文字' } },
]

const FIELD_STYLE = { background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

/** 固定の文字の部品。入力中はローカルに持ち、空のまま欄を離れたら外す */
function TextPart({ text, onChange, onRemove }: { text: string; onChange: (t: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(text)
  const [prev, setPrev] = useState(text)
  if (text !== prev) { setPrev(text); setDraft(text) }
  return (
    <input
      className="h-6 px-1 rounded text-[11px] font-mono nodrag nopan focus:outline-none"
      style={{ ...FIELD_STYLE, width: `${Math.max(1, draft.length) + 2}ch` }}
      value={draft}
      title="固定の文字（区切りの _ もここ）。空にすると外れます"
      onKeyDown={(e) => { stopKeys(e); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      onChange={(e) => { setDraft(e.target.value); if (e.target.value) onChange(e.target.value) }}
      onBlur={() => { if (!draft) onRemove() }}
    />
  )
}

export function NamePatternEditor({ pattern, onChange, example, exampleMore = 0 }: { pattern: string; onChange: (pattern: string) => void; example: string | null; exampleMore?: number }) {
  const parts = parseNamePattern(pattern)
  const presetId = presetIdOf(pattern)
  const set = (next: NamePart[]) => onChange(buildNamePattern(next) || NAME_PRESETS[0].pattern)
  return (
    <div className="flex flex-col gap-1.5">
      <select
        className="h-8 w-full rounded-md pl-2.5 text-[12px] nodrag nopan focus:outline-none"
        style={FIELD_STYLE}
        value={presetId}
        onChange={(e) => { const p = NAME_PRESETS.find((x) => x.id === e.target.value); if (p) onChange(p.pattern) }}
        title="名前の型を選ぶ。下の部品を足したり外したりすると「自分で組む」になります"
      >
        {NAME_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="custom" disabled={presetId !== 'custom'}>自分で組む</option>
      </select>
      <div className="flex flex-wrap items-center gap-1">
        {parts.map((p, i) => (p.kind === 'text' ? (
          <TextPart
            key={i}
            text={p.text}
            onChange={(t) => set(parts.map((x, j) => (j === i ? { kind: 'text', text: t } : x)))}
            onRemove={() => set(parts.filter((_, j) => j !== i))}
          />
        ) : (
          <span key={i} className="inline-flex items-center gap-0.5 h-6 pl-2 pr-0.5 rounded text-[11px]" style={{ background: 'rgba(20,184,166,0.12)', color: PP_ACCENT }}>
            {namePartLabel(p)}
            <button type="button" className="w-4 h-4 flex items-center justify-center rounded nodrag hover:bg-[var(--bg-elevated)]" title="この部品を外す" onClick={() => set(removeNamePart(parts, i))}><X size={10} /></button>
          </span>
        )))}
        <select
          className="h-6 rounded text-[11px] nodrag nopan select-compact focus:outline-none"
          style={{ background: 'transparent', border: '1px dashed var(--border-active)', color: 'var(--text-secondary)', paddingLeft: 6 }}
          value=""
          onChange={(e) => { const o = ADD_OPTIONS.find((x) => x.value === e.target.value); if (o) set(appendNamePart(parts, o.part)) }}
          title="部品を足す"
        >
          <option value="">＋ 部品を足す</option>
          {ADD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {example && (
        <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }} title={example}>
          例: <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{example}</span>{exampleMore > 0 ? ` ほか ${exampleMore} 件` : ''}
        </div>
      )}
    </div>
  )
}
