import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, X } from '@phosphor-icons/react'
import type { LayoutParams } from '../../../types/nodes'
import type { ReviewVariant } from '../../../lib/review/model'
import { LayoutParamsForm } from '../../nodes/pp/LayoutParamsForm'

interface Props {
  open: boolean
  variants: ReviewVariant[]
  saving: boolean
  onClose: () => void
  onApply: (overrides: Record<string, LayoutParams>) => Promise<void>
  onReset: () => Promise<void>
}

/** バリアントのレイアウト設定をジョブ単位で変更し、全アイテムに再適用する（fal は呼ばない。仕様 5 章） */
export function LayoutSettingsDrawer(props: Props) {
  if (!props.open) return null
  return <LayoutSettingsDrawerInner {...props} />
}

function LayoutSettingsDrawerInner({ variants, saving, onClose, onApply, onReset }: Props) {
  const [active, setActive] = useState<string>(variants[0]?.key ?? '')
  // 開くたびにマウントされるので、下書きは初期値で足りる
  const [draft, setDraft] = useState<Record<string, LayoutParams>>(() => { const d: Record<string, LayoutParams> = {}; for (const v of variants) d[v.key] = v.params; return d })
  const cur = variants.find((v) => v.key === active) ?? variants[0]
  const changed = useMemo(() => variants.filter((v) => draft[v.key] && JSON.stringify(draft[v.key]) !== JSON.stringify(v.params)).length, [draft, variants])
  const anyOverride = variants.some((v) => v.overridden)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [saving, onClose])
  const apply = async () => {
    const overrides: Record<string, LayoutParams> = {}
    for (const v of variants) {
      const d = draft[v.key]
      if (!d) continue
      if (JSON.stringify(d) !== JSON.stringify(v.baseParams)) overrides[v.key] = d
    }
    await onApply(overrides)
  }
  return createPortal(
    <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.35)' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <aside className="absolute right-0 top-0 h-full w-[420px] max-w-[95vw] flex flex-col" style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(0,0,0,0.3)' }}>
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>レイアウト設定（ジョブ単位）</h2>
          <button onClick={onClose} disabled={saving} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }}><X size={14} /></button>
        </div>
        <div className="flex items-center gap-1 px-4 pt-3 flex-wrap">
          {variants.map((v) => (
            <button key={v.key} onClick={() => setActive(v.key)} className="h-7 px-2.5 rounded-md text-[11px] font-medium" style={{ background: active === v.key ? 'var(--bg-elevated)' : 'transparent', color: active === v.key ? 'var(--text-primary)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              {v.name}{v.overridden ? ' *' : ''}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto px-4 py-3">
          {cur && draft[cur.key] ? (
            <>
              <div className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                バリアント名は投入時の設定のまま使います。変更は描画にだけ効き、fal.ai への要求は発生しません。
              </div>
              <LayoutParamsForm params={draft[cur.key]} showVariantName={false} onChange={(patch) => setDraft((d) => ({ ...d, [cur.key]: { ...d[cur.key], ...patch } }))} />
            </>
          ) : <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>この写しにはレイアウトノードがありません</div>}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => void onReset()} disabled={saving || !anyOverride} className="h-8 px-3 rounded-lg text-[12px] disabled:opacity-50 hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>投入時の設定に戻す</button>
          <div className="flex-1" />
          <button onClick={onClose} disabled={saving} className="h-8 px-3 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }}>閉じる</button>
          <button onClick={() => void apply()} disabled={saving || changed === 0} className="h-8 px-4 rounded-lg text-[12px] font-medium text-white flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {saving && <CircleNotch size={12} className="animate-spin" />}全アイテムに再適用{changed ? `（${changed} バリアント）` : ''}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
