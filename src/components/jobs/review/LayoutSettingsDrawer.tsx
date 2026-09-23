import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, Plus, Trash, X } from '@phosphor-icons/react'
import type { LayoutParams } from '../../../types/nodes'
import { DEFAULT_LAYOUT_PARAMS } from '../../../lib/layout/computeLayout'
import { newVariantKey, type ReviewVariant } from '../../../lib/review/model'
import { LayoutParamsForm } from '../../nodes/pp/LayoutParamsForm'

/** 保存先の種類: workflow = 元ワークフローのノードに書き戻す / job = このジョブにだけ保存 */
export type LayoutSaveTarget = 'workflow' | 'job-shared' | 'job-snapshot'

/** ドロワーが出す変更計画。保存先は呼び出し側（JobDetailPage）が決める */
export interface LayoutChangePlan {
  updated: Record<string, LayoutParams>   // 既存バリアント（キー = ノード ID / added-N）の新しい設定
  added: Array<{ key: string; params: LayoutParams }>   // 新規（仮キー added-N）
  removed: string[]                       // 削除する既存バリアントのキー
}

interface Props {
  open: boolean
  variants: ReviewVariant[]
  target: LayoutSaveTarget
  sourceName?: string | null
  saving: boolean
  onClose: () => void
  onApply: (plan: LayoutChangePlan) => Promise<void>
  onReset: () => Promise<void>
  canReset: boolean
}

export function LayoutSettingsDrawer(props: Props) {
  if (!props.open) return null
  return <LayoutSettingsDrawerInner {...props} />
}

function LayoutSettingsDrawerInner({ variants, target, sourceName, saving, onClose, onApply, onReset, canReset }: Props) {
  // 開くたびにマウントされるので、下書きは初期値で足りる
  const [draft, setDraft] = useState<Record<string, LayoutParams>>(() => { const d: Record<string, LayoutParams> = {}; for (const v of variants) d[v.key] = v.params; return d })
  const [order, setOrder] = useState<string[]>(() => variants.map((v) => v.key))
  const [newKeys, setNewKeys] = useState<string[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [active, setActive] = useState<string>(variants[0]?.key ?? '')
  const existing = useMemo(() => new Map(variants.map((v) => [v.key, v])), [variants])
  const tabs = useMemo(() => order.filter((k) => !removed.includes(k)).map((k) => ({ key: k, name: draft[k]?.variantName ?? k, isNew: newKeys.includes(k), added: existing.get(k)?.added ?? false })), [order, removed, draft, newKeys, existing])
  const cur = tabs.find((t) => t.key === active) ?? tabs[0]
  const canDelete = (key: string) => newKeys.includes(key) || target === 'workflow' || existing.get(key)?.added

  const plan = useMemo<LayoutChangePlan>(() => {
    const updated: Record<string, LayoutParams> = {}
    for (const v of variants) {
      if (removed.includes(v.key)) continue
      const d = draft[v.key]
      if (d && JSON.stringify(d) !== JSON.stringify(v.params)) updated[v.key] = d
    }
    const added = newKeys.filter((k) => !removed.includes(k)).map((k) => ({ key: k, params: draft[k] }))
    return { updated, added, removed: removed.filter((k) => existing.has(k)) }
  }, [variants, draft, newKeys, removed, existing])
  const changeCount = Object.keys(plan.updated).length + plan.added.length + plan.removed.length

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [saving, onClose])

  const addVariant = () => {
    const key = newVariantKey([...variants.map((v) => v.key), ...newKeys])
    setDraft((d) => ({ ...d, [key]: { ...DEFAULT_LAYOUT_PARAMS, variantName: `variant_${tabs.length + 1}` } }))
    setOrder((o) => [...o, key])
    setNewKeys((k) => [...k, key])
    setActive(key)
  }
  const removeVariant = (key: string) => {
    setRemoved((r) => [...r, key])
    const rest = tabs.filter((t) => t.key !== key)
    setActive(rest[0]?.key ?? '')
  }

  const notice = target === 'workflow'
    ? `変更は元のワークフロー「${sourceName ?? ''}」の Product Layout ノードに保存され、キャンバスにも反映されます。切り抜きは保存済みなので fal.ai への要求は発生しません。`
    : target === 'job-shared'
      ? '元のワークフローは他のメンバーのものなので編集できません。変更はこのジョブにだけ保存します（fal.ai への要求は発生しません）。'
      : 'このジョブは投入時の写しにレイアウトを持っています。変更はこのジョブにだけ保存します（fal.ai への要求は発生しません）。'

  return createPortal(
    <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.35)' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <aside className="absolute right-0 top-0 h-full w-[420px] max-w-[95vw] flex flex-col" style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(0,0,0,0.3)' }}>
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>レイアウト設定（バリアント）</h2>
          <button onClick={onClose} disabled={saving} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }}><X size={14} /></button>
        </div>
        <div className="px-4 pt-3 text-[11px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>{notice}</div>
        <div className="flex items-center gap-1 px-4 pt-2 flex-wrap">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setActive(t.key)} className="h-7 px-2.5 rounded-md text-[11px] font-medium" style={{ background: cur?.key === t.key ? 'var(--bg-elevated)' : 'transparent', color: cur?.key === t.key ? 'var(--text-primary)' : 'var(--text-secondary)', border: '1px solid var(--border)' }} title={t.isNew ? '新規（保存で追加）' : t.added ? 'このジョブで追加したバリアント' : 'ワークフローのバリアント'}>
              {t.name}{t.isNew ? ' ＋' : plan.updated[t.key] ? ' *' : ''}
            </button>
          ))}
          <button onClick={addVariant} disabled={saving} className="h-7 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--accent)', border: '1px dashed var(--border-active)' }} title={target === 'workflow' ? 'Product Layout ノードを追加（切り抜きの再実行は不要）' : 'バリアントを追加（このジョブにだけ保存）'}>
            <Plus size={12} />追加
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-3">
          {cur && draft[cur.key] ? (
            <>
              <LayoutParamsForm params={draft[cur.key]} showVariantName={target === 'workflow' || cur.isNew || cur.added} onChange={(patch) => setDraft((d) => ({ ...d, [cur.key]: { ...d[cur.key], ...patch } }))} />
              {canDelete(cur.key) && (
                <button onClick={() => removeVariant(cur.key)} disabled={saving} className="mt-4 h-7 px-2 rounded-md text-[11px] flex items-center gap-1 hover:bg-[var(--bg-elevated)]" style={{ color: '#EF4444', border: '1px solid rgba(239,68,68,0.35)' }} title={target === 'workflow' && !cur.isNew ? 'ワークフローからノードを削除します' : undefined}>
                  <Trash size={12} />このバリアントを削除
                </button>
              )}
            </>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              バリアントがありません。「追加」で作ると、切り抜きを再実行せずにレイアウトを作れます。
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          {canReset && (
            <button onClick={() => void onReset()} disabled={saving} className="h-8 px-3 rounded-lg text-[12px] disabled:opacity-50 hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} title="このジョブだけの上書きと追加分を消します">ジョブ側の変更を消す</button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} disabled={saving} className="h-8 px-3 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }}>閉じる</button>
          <button onClick={() => void onApply(plan)} disabled={saving || changeCount === 0} className="h-8 px-4 rounded-lg text-[12px] font-medium text-white flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {saving && <CircleNotch size={12} className="animate-spin" />}全アイテムに再適用{changeCount ? `（${changeCount} 件）` : ''}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
