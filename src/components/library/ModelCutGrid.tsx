// ライブラリのモデルから「1 つの向きのカット」を選ぶグリッド（2026-11-01）。「画像を追加」ダイアログのモデルタブで使う。自分のモデルとチーム共有のモデルが並ぶ
import { useEffect, useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { MediaImg } from '../ui/MediaImg'
import { CutRoleIcon } from '../app/CutRoleIcon'
import { modelCutKey, modelRolesToShow } from '../../lib/library/modelRoles'
import type { CutRole } from '../../lib/video/productVideo'
import { signLibraryItems, type LibraryItem } from '../../lib/api/library'
import { fetchLibraryItemsByIds, listLibraryModels, modelItemIds, type LibraryModel } from '../../lib/api/libraryModels'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../hooks/useToast'

interface Props { onPick: (model: LibraryModel, role: CutRole, item: LibraryItem, signedUrl: string) => void; selectedKey?: string | null }

export function ModelCutGrid({ onPick, selectedKey = null }: Props) {
  const [models, setModels] = useState<LibraryModel[]>([])
  const [items, setItems] = useState<Record<string, LibraryItem>>({})
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [myId, setMyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const [{ data: { user } }, list] = await Promise.all([supabase.auth.getUser(), listLibraryModels()])
      if (!alive) return
      setMyId(user?.id ?? null); setModels(list)
      const all = await fetchLibraryItemsByIds(list.flatMap(modelItemIds))
      if (!alive) return
      setItems(Object.fromEntries(all.map((it) => [it.id, it])))
      setSigned(await signLibraryItems(all))
    })().catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error')).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={20} className="animate-spin" /></div>
  if (!models.length) return <div className="py-10 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>モデルがまだありません。ライブラリの「モデル」タブから登録できます</div>
  return (
    <div className="flex flex-col gap-3">
      {models.map((m) => (
        <div key={m.id} className="rounded-lg p-3" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
          <div className="flex items-baseline gap-2 mb-2 min-w-0">
            <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</span>
            {myId && m.user_id !== myId && <span className="px-1.5 rounded text-[9px] font-medium text-white shrink-0" style={{ background: 'rgba(0,0,0,0.55)' }}>チーム</span>}
            {m.note && <span className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{m.note}</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            {modelRolesToShow(m.cuts).map((r) => {
              const itemId = m.cuts[r.id]
              const it = itemId ? items[itemId] : undefined
              const url = it ? signed[it.id] : undefined
              const on = selectedKey === modelCutKey(m.id, r.id)
              return (
                <button key={r.id} type="button" disabled={!it || !url} className="relative rounded-md overflow-hidden focus:outline-none disabled:cursor-default" style={{ width: 96, height: 128, background: 'var(--bg-placeholder)', border: `1px ${it ? 'solid' : 'dashed'} var(--border-active)`, ...(on ? { boxShadow: '0 0 0 2px #8B5CF6' } : {}) }} title={it ? `${r.label}を使う` : `${r.label}のカットはありません`} onClick={() => { if (it && url) onPick(m, r.id, it, url) }}>
                  {it && url ? <MediaImg src={url} className="absolute inset-0 w-full h-full object-cover" /> : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5" style={{ color: 'var(--text-tertiary)' }}><CutRoleIcon role={r.id} size={22} /><span className="text-[10px]">なし</span></div>
                  )}
                  <span className="absolute bottom-1 left-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>{r.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
