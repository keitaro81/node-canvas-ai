// ライブラリのモデルから「1 つの向きのカット」を選ぶダイアログ（2026-11-01・Try-On ノード用）。
// ModelPickerDialog（モデル丸ごと → 役割ごとの枠に一度に入れる）と違い、モデルの向き 1 枚を選んで返す。自分のモデルとチーム共有のモデルが並ぶ。
// preferredRole（ノードの向きの予定・テンプレートが付ける）があればその向きを目立たせ、モデル名を押すとその向きが入る。
// othersCount > 0 なら「キャンバスの他の Try-On にも同じモデルを向きごとに入れる」を選べる（テンプレートの 4 つを 1 回で埋める・2b-4）
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, X } from '@phosphor-icons/react'
import { MediaImg } from '../ui/MediaImg'
import { CutRoleIcon } from '../app/CutRoleIcon'
import { CheckButton } from '../ui/CheckButton'
import { modelRolesToShow } from '../../lib/library/modelRoles'
import { CUT_ROLE_LABEL, type CutRole } from '../../lib/video/productVideo'
import { signLibraryItems, type LibraryItem } from '../../lib/api/library'
import { fetchLibraryItemsByIds, listLibraryModels, modelItemIds, type LibraryModel } from '../../lib/api/libraryModels'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../hooks/useToast'

export interface ModelCutPickExtra { applyToOthers: boolean; items: Record<string, LibraryItem> }
interface Props { open: boolean; onClose: () => void; onPick: (model: LibraryModel, role: CutRole, item: LibraryItem, extra: ModelCutPickExtra) => void; preferredRole?: CutRole | null; othersCount?: number }

export function ModelCutPickerDialog({ open, onClose, onPick, preferredRole = null, othersCount = 0 }: Props) {
  const [models, setModels] = useState<LibraryModel[]>([])
  const [items, setItems] = useState<Record<string, LibraryItem>>({})
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [myId, setMyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [applyToOthers, setApplyToOthers] = useState(true)
  const pick = (m: LibraryModel, role: CutRole, it: LibraryItem) => { onPick(m, role, it, { applyToOthers: othersCount > 0 && applyToOthers, items }); onClose() }

  useEffect(() => {
    if (!open) return
    ;(async () => {
      setLoading(true)
      const [{ data: { user } }, list] = await Promise.all([supabase.auth.getUser(), listLibraryModels()])
      setMyId(user?.id ?? null); setModels(list)
      const all = await fetchLibraryItemsByIds(list.flatMap(modelItemIds))
      setItems(Object.fromEntries(all.map((it) => [it.id, it])))
      setSigned(await signLibraryItems(all))
    })().catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error')).finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', zIndex: 20000 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }} onDrop={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: 'min(880px, 94vw)', maxHeight: '86vh', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>モデルの向きを選ぶ</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{preferredRole ? `このノードの向きは「${CUT_ROLE_LABEL[preferredRole]}」です。モデル名を押すとその向きのカットが入ります（別の向きを押せばそれを使います）` : '選んだ向きのカットがモデル画像になります（服の写真と同じ向きを選んでください）'}</p>
          </div>
          <button type="button" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} onClick={onClose} title="閉じる"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-6 pb-5">
          {loading ? (
            <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={20} className="animate-spin" /></div>
          ) : models.length === 0 ? (
            <div className="py-10 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>モデルがまだありません。ライブラリの「モデル」タブから登録できます</div>
          ) : (
            <div className="flex flex-col gap-3">
              {models.map((m) => (
                <div key={m.id} className="rounded-lg p-3" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
                  <div className="flex items-baseline gap-2 mb-2 min-w-0">
                    {preferredRole && m.cuts[preferredRole] && items[m.cuts[preferredRole]!] ? (
                      <button type="button" className="text-[13px] font-medium truncate hover:underline" style={{ color: '#8B5CF6' }} title={`このモデルの${CUT_ROLE_LABEL[preferredRole]}を使う`} onClick={() => pick(m, preferredRole, items[m.cuts[preferredRole]!])}>{m.name}</button>
                    ) : (
                      <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                    )}
                    {myId && m.user_id !== myId && <span className="px-1.5 rounded text-[9px] font-medium text-white shrink-0" style={{ background: 'rgba(0,0,0,0.55)' }}>チーム</span>}
                    {m.note && <span className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{m.note}</span>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {modelRolesToShow(m.cuts).map((r) => {
                      const itemId = m.cuts[r.id]
                      const it = itemId ? items[itemId] : undefined
                      const url = it ? signed[it.id] : undefined
                      return (
                        <button
                          key={r.id} type="button" disabled={!it || !url}
                          className="relative rounded-md overflow-hidden focus:outline-none disabled:cursor-default group"
                          style={{ width: 96, height: 128, background: 'var(--bg-placeholder)', border: `1px ${it ? 'solid' : 'dashed'} var(--border-active)`, ...(preferredRole === r.id && it ? { boxShadow: '0 0 0 2px #8B5CF6' } : {}) }}
                          title={it ? `${r.label} を使う` : `${r.label} のカットはありません`}
                          onClick={() => { if (it) pick(m, r.id, it) }}
                        >
                          {it && url ? <MediaImg src={url} className="absolute inset-0 w-full h-full object-cover" /> : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              <CutRoleIcon role={r.id} size={22} /><span className="text-[10px]">なし</span>
                            </div>
                          )}
                          {it && <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ boxShadow: 'inset 0 0 0 2px #8B5CF6' }} />}
                          <span className="absolute bottom-1 left-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>{r.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {othersCount > 0 && (
          <div className="px-6 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <CheckButton checked={applyToOthers} onChange={setApplyToOthers} label="他の Try-On にも入れる" size={20} />
              <span className="text-[12px]" style={{ color: 'var(--text-primary)' }}>キャンバスの他の Try-On（{othersCount} 個）にも同じモデルを向きごとに入れる</span>
            </label>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
