// 登録済みモデルを選ぶダイアログ（2026-10-24）: 商品動画 App の SKU カードへ、モデルの写真を役割ごとの枠に一度に入れる
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, X } from '@phosphor-icons/react'
import { MediaImg } from '../ui/MediaImg'
import { CUT_ROLES, FRONTAL_ROLE } from '../../lib/video/productVideo'
import { signLibraryItems, type LibraryItem } from '../../lib/api/library'
import { fetchLibraryItemsByIds, listLibraryModels, modelItemIds, type LibraryModel } from '../../lib/api/libraryModels'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../hooks/useToast'

interface Props { open: boolean; onClose: () => void; onPick: (model: LibraryModel, items: LibraryItem[]) => void }

export function ModelPickerDialog({ open, onClose, onPick }: Props) {
  const [models, setModels] = useState<LibraryModel[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})   // model id → 正面の署名 URL
  const [myId, setMyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    ;(async () => {
      const [{ data: { user } }, list] = await Promise.all([supabase.auth.getUser(), listLibraryModels()])
      setMyId(user?.id ?? null); setModels(list)
      const fronts = list.map((m) => m.cuts[FRONTAL_ROLE]).filter((v): v is string => !!v)
      const items = await fetchLibraryItemsByIds(fronts)
      const signed = await signLibraryItems(items)
      const next: Record<string, string> = {}
      for (const m of list) { const id = m.cuts[FRONTAL_ROLE]; if (id && signed[id]) next[m.id] = signed[id] }
      setThumbs(next)
    })().catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error')).finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const pick = async (m: LibraryModel) => {
    setPicking(m.id)
    try {
      const items = await fetchLibraryItemsByIds(modelItemIds(m))
      onPick(m, items)
      onClose()
    } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setPicking(null) }
  }

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', zIndex: 20000 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: 'min(720px, 94vw)', maxHeight: '86vh', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>モデルから入れる</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>選んだモデルの写真を、役割ごとの枠に一度に入れます（枠に入っている写真は置き換わります）</p>
          </div>
          <button type="button" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} onClick={onClose} title="閉じる"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-6 pb-5">
          {loading ? (
            <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={20} className="animate-spin" /></div>
          ) : models.length === 0 ? (
            <div className="py-10 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>モデルがまだありません。ライブラリの「モデル」タブから登録できます</div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {models.map((m) => {
                const n = CUT_ROLES.filter((r) => !!m.cuts[r.id]).length
                return (
                  <button key={m.id} type="button" className="text-left rounded-lg overflow-hidden focus:outline-none disabled:opacity-60" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }} onClick={() => void pick(m)} disabled={!!picking} title={m.note ?? ''}>
                    <div className="relative w-full" style={{ aspectRatio: '4 / 5', background: 'var(--bg-placeholder)' }}>
                      <MediaImg src={thumbs[m.id] ?? ''} className="absolute inset-0 w-full h-full object-cover" />
                      {picking === m.id && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.6)' }}><CircleNotch size={16} className="animate-spin" /></div>}
                      {myId && m.user_id !== myId && <span className="absolute bottom-1.5 left-1.5 px-1.5 rounded text-[9px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>チーム</span>}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{n} 方向のカット</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
