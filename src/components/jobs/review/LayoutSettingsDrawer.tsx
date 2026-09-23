import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, Plus, Trash, X } from '@phosphor-icons/react'
import type { LayoutParams } from '../../../types/nodes'
import { DEFAULT_LAYOUT_PARAMS } from '../../../lib/layout/computeLayout'
import { ADDED_VARIANTS_KEY, newVariantKey, type ReviewVariant } from '../../../lib/review/model'
import { LayoutParamsForm } from '../../nodes/pp/LayoutParamsForm'

interface Props {
  open: boolean
  variants: ReviewVariant[]
  saving: boolean
  onClose: () => void
  onApply: (overrides: Record<string, unknown>) => Promise<void>
  onReset: () => Promise<void>
}

/**
 * バリアントのレイアウト設定をジョブ単位で変更し、全アイテムに再適用する（fal は呼ばない。仕様 5 章）。
 * 写しに無いバリアントも「追加」できる（layout_overrides.__added に保存。切り抜きの再実行は不要）。
 */
export function LayoutSettingsDrawer(props: Props) {
  if (!props.open) return null
  return <LayoutSettingsDrawerInner {...props} />
}

function LayoutSettingsDrawerInner({ variants, saving, onClose, onApply, onReset }: Props) {
  const nodeVariants = useMemo(() => variants.filter((v) => !v.added), [variants])
  const initialAdded = useMemo(() => variants.filter((v) => v.added), [variants])
  // 開くたびにマウントされるので、下書きは初期値で足りる
  const [draft, setDraft] = useState<Record<string, LayoutParams>>(() => { const d: Record<string, LayoutParams> = {}; for (const v of variants) d[v.key] = v.params; return d })
  const [addedKeys, setAddedKeys] = useState<string[]>(() => initialAdded.map((v) => v.key))
  const [active, setActive] = useState<string>(variants[0]?.key ?? '')
  const tabs = useMemo(() => [...nodeVariants.map((v) => ({ key: v.key, name: v.name, added: false })), ...addedKeys.map((k) => ({ key: k, name: draft[k]?.variantName ?? k, added: true }))], [nodeVariants, addedKeys, draft])
  const cur = tabs.find((t) => t.key === active) ?? tabs[0]

  const changedNodes = useMemo(() => nodeVariants.filter((v) => draft[v.key] && JSON.stringify(draft[v.key]) !== JSON.stringify(v.params)).length, [draft, nodeVariants])
  const addedChanged = useMemo(() => {
    const before = JSON.stringify(initialAdded.map((v) => ({ key: v.key, params: v.params })))
    const now = JSON.stringify(addedKeys.map((k) => ({ key: k, params: draft[k] })))
    return before !== now
  }, [initialAdded, addedKeys, draft])
  const changed = changedNodes + (addedChanged ? 1 : 0)
  const anyOverride = variants.some((v) => v.overridden || v.added)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [saving, onClose])

  const addVariant = () => {
    const key = newVariantKey([...variants.map((v) => v.key), ...addedKeys])
    const n = tabs.length + 1
    setDraft((d) => ({ ...d, [key]: { ...DEFAULT_LAYOUT_PARAMS, variantName: `variant_${n}` } }))
    setAddedKeys((k) => [...k, key])
    setActive(key)
  }
  const removeVariant = (key: string) => {
    setAddedKeys((k) => k.filter((x) => x !== key))
    setActive((a) => (a === key ? (nodeVariants[0]?.key ?? addedKeys.find((x) => x !== key) ?? '') : a))
  }
  const apply = async () => {
    const overrides: Record<string, unknown> = {}
    for (const v of nodeVariants) {
      const d = draft[v.key]
      if (d && JSON.stringify(d) !== JSON.stringify(v.baseParams)) overrides[v.key] = d
    }
    if (addedKeys.length) overrides[ADDED_VARIANTS_KEY] = addedKeys.map((k) => ({ key: k, params: draft[k] }))
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
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setActive(t.key)} className="h-7 px-2.5 rounded-md text-[11px] font-medium" style={{ background: cur?.key === t.key ? 'var(--bg-elevated)' : 'transparent', color: cur?.key === t.key ? 'var(--text-primary)' : 'var(--text-secondary)', border: '1px solid var(--border)' }} title={t.added ? 'ジョブ画面で追加したバリアント' : '投入時のワークフローのバリアント'}>
              {t.name}{t.added ? ' ＋' : variants.find((v) => v.key === t.key)?.overridden ? ' *' : ''}
            </button>
          ))}
          <button onClick={addVariant} disabled={saving} className="h-7 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--accent)', border: '1px dashed var(--border-active)' }} title="バリアントを追加（切り抜きの再実行は不要）">
            <Plus size={12} />追加
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-3">
          {cur && draft[cur.key] ? (
            <>
              <div className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                {cur.added
                  ? 'このバリアントはジョブに保存されます（投入時のワークフローは変わりません）。切り抜きは保存済みなので、fal.ai への要求は発生しません。'
                  : 'バリアント名は投入時の設定のまま使います。変更は描画にだけ効き、fal.ai への要求は発生しません。'}
              </div>
              <LayoutParamsForm params={draft[cur.key]} showVariantName={cur.added} onChange={(patch) => setDraft((d) => ({ ...d, [cur.key]: { ...d[cur.key], ...patch } }))} />
              {cur.added && (
                <button onClick={() => removeVariant(cur.key)} disabled={saving} className="mt-4 h-7 px-2 rounded-md text-[11px] flex items-center gap-1 hover:bg-[var(--bg-elevated)]" style={{ color: '#EF4444', border: '1px solid rgba(239,68,68,0.35)' }}>
                  <Trash size={12} />このバリアントを削除
                </button>
              )}
            </>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              投入時のワークフローにレイアウトノードがありません。「追加」でバリアントを作ると、切り抜きを再実行せずにレイアウトを作れます。
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => void onReset()} disabled={saving || !anyOverride} className="h-8 px-3 rounded-lg text-[12px] disabled:opacity-50 hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} title="上書きした設定と追加したバリアントを消して、投入時の設定に戻します">投入時の設定に戻す</button>
          <div className="flex-1" />
          <button onClick={onClose} disabled={saving} className="h-8 px-3 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }}>閉じる</button>
          <button onClick={() => void apply()} disabled={saving || changed === 0} className="h-8 px-4 rounded-lg text-[12px] font-medium text-white flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {saving && <CircleNotch size={12} className="animate-spin" />}全アイテムに再適用{changed ? `（${changed} 件）` : ''}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
