// モデル（人物）の登録・編集ダイアログ（2026-10-24）: 名前・メモ・役割ごとのカット（正面必須）・チーム共有。
// カットは「画像を追加」ダイアログから選ぶ（アップロード / ライブラリ / 生成画像）。他人の共有素材や生成画像は自分のライブラリへ複製してから使う（モデルの整合性を自分で保てるように）
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, X } from '@phosphor-icons/react'
import { CutRoleIcon } from '../app/CutRoleIcon'
import { CheckButton } from '../ui/CheckButton'
import { MediaImg } from '../ui/MediaImg'
import { MediaPickerDialog, type PickedMedia } from './MediaPickerDialog'
import { CUT_ROLES, FRONTAL_ROLE, type CutRole } from '../../lib/video/productVideo'
import { pickedToFiles, signLibraryItems, uploadToLibrary, type LibraryItem, type LibraryVisibility } from '../../lib/api/library'
import { createLibraryModel, fetchLibraryItemsByIds, pinLibraryItems, shareLibraryItemsWithTeam, updateLibraryModel, type LibraryModel } from '../../lib/api/libraryModels'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../hooks/useToast'

const ACCENT = '#EC4899'
interface Props { open: boolean; onClose: () => void; model?: LibraryModel | null; onSaved: (model: LibraryModel) => void }

export function ModelEditorDialog({ open, onClose, model, onSaved }: Props) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [visibility, setVisibility] = useState<LibraryVisibility>('private')
  const [cuts, setCuts] = useState<Partial<Record<CutRole, LibraryItem>>>({})
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [pickerRole, setPickerRole] = useState<CutRole | null>(null)
  const [busyRole, setBusyRole] = useState<CutRole | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(model?.name ?? ''); setNote(model?.note ?? ''); setVisibility(model?.visibility ?? 'private'); setCuts({}); setSigned({})
    if (!model) return
    const ids = Object.values(model.cuts).filter((v): v is string => !!v)
    if (!ids.length) return
    setLoading(true)
    fetchLibraryItemsByIds(ids).then(async (items) => {
      const byId = new Map(items.map((it) => [it.id, it]))
      const next: Partial<Record<CutRole, LibraryItem>> = {}
      for (const r of CUT_ROLES) { const id = model.cuts[r.id]; const it = id ? byId.get(id) : undefined; if (it) next[r.id] = it }
      setCuts(next); setSigned(await signLibraryItems(items))
    }).catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error')).finally(() => setLoading(false))
  }, [open, model])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pickerRole) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, pickerRole])

  // 選んだ素材を「自分の素材」にする（自分のものはそのまま、他人の共有・生成画像は複製）
  const ensureOwnItem = useCallback(async (picked: PickedMedia): Promise<LibraryItem> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (picked.libraryItemId) {
      const [it] = await fetchLibraryItemsByIds([picked.libraryItemId])
      if (it && it.user_id === user?.id) return it
    }
    const [file] = await pickedToFiles([picked])
    return uploadToLibrary(file, { media: 'image', source: 'model', name: picked.name ?? undefined })
  }, [])

  const onPick = async (role: CutRole, items: PickedMedia[]) => {
    const picked = items[0]
    if (!picked) return
    setBusyRole(role)
    try {
      const it = await ensureOwnItem(picked)
      setCuts((cur) => ({ ...cur, [role]: it }))
      const map = await signLibraryItems([it])
      setSigned((cur) => ({ ...cur, ...map }))
    } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setBusyRole(null) }
  }

  const save = async () => {
    if (!name.trim()) { showToast('モデルの名前を入れてください', 'warning'); return }
    if (!cuts[FRONTAL_ROLE]) { showToast('正面のカットは必須です', 'warning'); return }
    setSaving(true)
    try {
      const ids = Object.fromEntries(Object.entries(cuts).map(([r, it]) => [r, it!.id])) as Partial<Record<CutRole, string>>
      const saved = model ? await updateLibraryModel(model.id, { name, note: note.trim() || null, cuts: ids, visibility }) : await createLibraryModel({ name, note, cuts: ids, visibility })
      const itemIds = Object.values(ids).filter((v): v is string => !!v)
      await pinLibraryItems(itemIds)   // モデルの素材は自動削除から外す
      if (visibility === 'team') await shareLibraryItemsWithTeam(itemIds)   // 共有モデルの写真はメンバーも見られる必要がある
      onSaved(saved)
      onClose()
    } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setSaving(false) }
  }

  if (!open) return null
  const filled = CUT_ROLES.filter((r) => !!cuts[r.id]).length
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', zIndex: 20000 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: 'min(720px, 94vw)', maxHeight: '90vh', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{model ? 'モデルを編集' : 'モデルを登録'}</h2>
          <button type="button" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} onClick={onClose} title="閉じる"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-6 pb-4 flex flex-col gap-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>名前</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: モデル A（160cm）" className="h-9 rounded-md px-3 text-[13px] focus:outline-none" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>メモ（任意）</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 春夏カタログ用・身長 160cm" className="h-9 rounded-md px-3 text-[13px] focus:outline-none" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>カット（同じ人物・同じ服装で。正面は必須）</span>
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{filled} / {CUT_ROLES.length}</span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={18} className="animate-spin" /></div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {CUT_ROLES.map((r) => {
                  const it = cuts[r.id]; const required = r.id === FRONTAL_ROLE; const busy = busyRole === r.id
                  return (
                    <div key={r.id} className="relative rounded-lg overflow-hidden cursor-pointer select-none flex flex-col items-center justify-center text-center" style={{ height: 120, background: 'var(--bg-placeholder)', border: `1px ${it ? 'solid' : 'dashed'} ${required && !it ? ACCENT : 'var(--border-active)'}` }} title={`${r.label}: ${r.hint}。クリックで追加（アップロード / ライブラリ）`} onClick={() => setPickerRole(r.id)}>
                      {it && signed[it.id] ? <MediaImg src={signed[it.id]} className="absolute inset-0 w-full h-full object-cover" /> : null}
                      {!it && !busy && (
                        <div className="flex flex-col items-center gap-0.5" style={{ color: 'var(--text-secondary)' }}>
                          <CutRoleIcon role={r.id} size={24} />
                          <span className="text-[10px] font-medium">{r.label}{required ? ' *' : ''}</span>
                        </div>
                      )}
                      {busy && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.6)' }}><CircleNotch size={16} className="animate-spin" /></div>}
                      {it && (
                        <>
                          <span className="absolute bottom-1 left-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>{r.label}</span>
                          <button type="button" className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(0,0,0,0.55)' }} title="このカットを外す" onClick={(e) => { e.stopPropagation(); setCuts((cur) => { const next = { ...cur }; delete next[r.id]; return next }) }}><X size={10} /></button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <CheckButton checked={visibility === 'team'} onChange={(v) => setVisibility(v ? 'team' : 'private')} label="チームに共有" size={20} />
            <span className="text-[12px]" style={{ color: 'var(--text-primary)' }}>チームに共有する</span>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>メンバーも商品動画 App でこのモデルを使えます。モデルの写真もチームに共有されます</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button type="button" className="h-9 px-4 rounded-lg text-[13px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} onClick={onClose}>キャンセル</button>
          <button type="button" className="h-9 px-4 rounded-lg text-[13px] font-medium text-white disabled:opacity-50 flex items-center gap-2" style={{ background: ACCENT }} onClick={() => void save()} disabled={saving || !!busyRole}>
            {saving && <CircleNotch size={14} className="animate-spin" />}{model ? '保存する' : '登録する'}
          </button>
        </div>
      </div>
      <MediaPickerDialog open={!!pickerRole} onClose={() => setPickerRole(null)} media="image" source="model" onPick={(items) => { const role = pickerRole; if (role) void onPick(role, items) }} />
    </div>,
    document.body,
  )
}
