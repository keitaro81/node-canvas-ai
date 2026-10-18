// 「画像を追加」ダイアログ（2026-10-18）: ライブラリ（アップロード・チーム共有）と自分の生成物から選ぶ。上でアップロードもできる（ライブラリに登録される）。
// 単一選択（1 枚の入力）と複数選択（複数可の入力）に対応。選んだ素材は最終利用を記録する。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleNotch, CloudArrowUp, Play, X } from '@phosphor-icons/react'
import { CheckButton } from '../ui/CheckButton'
import { MediaImg } from '../ui/MediaImg'
import { getMyGenerations, type GenerationWithWorkflow } from '../../lib/api/generations'
import { signMediaRequest } from '../../lib/api/storage'
import { libraryCanonicalUrl, listLibraryItems, signLibraryItems, touchLibraryItems, uploadToLibrary, type LibraryItem, type LibraryMedia } from '../../lib/api/library'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../hooks/useToast'

const ACCENT = '#8B5CF6'
const PREVIEW_COUNT = 8

export interface PickedMedia {
  url: string                 // 保存形式の URL（表示・生成時にサーバーで署名する）
  media: LibraryMedia
  libraryItemId?: string
  generationId?: string
  name?: string | null
  width?: number | null
  height?: number | null
  file?: File                 // このダイアログでアップロードした元ファイル（再取得せずに使える）
}
interface Props {
  open: boolean
  onClose: () => void
  media: LibraryMedia         // 受け付ける種類
  multiple?: boolean
  title?: string
  source?: string             // ここからアップロードしたときの登録元（例 'canvas' / 'capsule'）
  onPick: (items: PickedMedia[]) => void
}

type Entry = { key: string; kind: 'upload' | 'generated'; media: LibraryMedia; url: string; name: string | null; isTeam: boolean; createdAt: string; lib?: LibraryItem; gen?: GenerationWithWorkflow }
type TabId = 'all' | 'uploads' | 'gen-image' | 'gen-video'

const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

export function MediaPickerDialog({ open, onClose, media, multiple = false, title, source = 'upload', onPick }: Props) {
  const [tab, setTab] = useState<TabId>('all')
  const [uploads, setUploads] = useState<LibraryItem[]>([])
  const [gens, setGens] = useState<GenerationWithWorkflow[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})   // entry.key → 署名 URL
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [selected, setSelected] = useState<string[]>([])            // entry.key（選んだ順）
  const [myId, setMyId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const uploadedFiles = useRef(new Map<string, File>())   // entry.key → このダイアログで上げた File

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: { user } }, libs, gs] = await Promise.all([supabase.auth.getUser(), listLibraryItems({ media }), getMyGenerations()])
      setMyId(user?.id ?? null)
      setUploads(libs)
      const wanted = gs.filter((g) => !!g.output_url && ((isVideoUrl(g.output_url) || g.node_type === 'video-generation') === (media === 'video')))
      setGens(wanted)
      const [libMap, genMap] = await Promise.all([
        signLibraryItems(libs),
        signMediaRequest({ urls: wanted.map((g) => g.output_url) }),
      ])
      const next: Record<string, string> = {}
      for (const l of libs) if (libMap[l.id]) next[`lib:${l.id}`] = libMap[l.id]
      for (const g of wanted) if (g.output_url && genMap[g.output_url]) next[`gen:${g.id}`] = genMap[g.output_url]
      setSigned(next)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally { setLoading(false) }
  }, [media])

  useEffect(() => {
    if (!open) return
    setTab('all'); setSelected([]); uploadedFiles.current.clear()
    void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const entries = useMemo<Entry[]>(() => [
    ...uploads.map((l): Entry => ({ key: `lib:${l.id}`, kind: 'upload', media: l.media, url: libraryCanonicalUrl(l), name: l.name, isTeam: !!myId && l.user_id !== myId, createdAt: l.created_at, lib: l })),
    ...gens.map((g): Entry => ({ key: `gen:${g.id}`, kind: 'generated', media, url: g.output_url as string, name: g.workflow_name ?? null, isTeam: false, createdAt: g.created_at, gen: g })),
  ], [uploads, gens, media, myId])
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries])
  const uploadEntries = entries.filter((e) => e.kind === 'upload')
  const genEntries = entries.filter((e) => e.kind === 'generated')

  const toggle = (key: string) => {
    setSelected((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key)
      return multiple ? [...cur, key] : [key]
    })
  }

  const onFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter((f) => (media === 'video' ? f.type.startsWith('video/') : f.type.startsWith('image/')))
    if (!list.length) { showToast(media === 'video' ? '動画ファイルを選んでください' : '画像ファイルを選んでください', 'warning'); return }
    setUploading((n) => n + list.length)
    const added: LibraryItem[] = []
    for (const f of list) {
      try { const item = await uploadToLibrary(f, { media, source }); added.push(item); uploadedFiles.current.set(`lib:${item.id}`, f) }
      catch (e) { showToast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, 'error') }
      finally { setUploading((n) => n - 1) }
    }
    if (!added.length) return
    if (!multiple) {
      // 1 枚だけ受ける入力: 上げた瞬間に採用して閉じる（「クリックしてアップロード」と同じ手数）
      const last = added[added.length - 1]
      void touchLibraryItems([last.id])
      onPick([{ url: libraryCanonicalUrl(last), media: last.media, libraryItemId: last.id, name: last.name, width: last.width, height: last.height, file: uploadedFiles.current.get(`lib:${last.id}`) }])
      onClose()
      return
    }
    const map = await signLibraryItems(added)
    setUploads((cur) => [...added, ...cur])
    setSigned((cur) => { const next = { ...cur }; for (const l of added) if (map[l.id]) next[`lib:${l.id}`] = map[l.id]; return next })
    setSelected((cur) => [...cur, ...added.map((l) => `lib:${l.id}`)])
  }

  const confirm = () => {
    const picked = selected.map((k) => byKey.get(k)).filter((e): e is Entry => !!e)
    if (!picked.length) return
    void touchLibraryItems(picked.map((e) => e.lib?.id).filter((id): id is string => !!id))
    onPick(picked.map((e) => ({ url: e.url, media: e.media, libraryItemId: e.lib?.id, generationId: e.gen?.id, name: e.name, width: e.lib?.width ?? null, height: e.lib?.height ?? null, file: uploadedFiles.current.get(e.key) })))
    onClose()
  }

  if (!open) return null
  const noun = media === 'video' ? '動画' : '画像'
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'all', label: 'すべて' }, { id: 'uploads', label: 'アップロード' },
    ...(media === 'image' ? [{ id: 'gen-image' as TabId, label: 'AI 画像生成' }] : [{ id: 'gen-video' as TabId, label: 'AI 動画生成' }]),
  ]
  const genTabId: TabId = media === 'image' ? 'gen-image' : 'gen-video'
  const genLabel = media === 'image' ? 'AI 画像生成' : 'AI 動画生成'

  const tile = (e: Entry) => {
    const on = selected.includes(e.key)
    const url = signed[e.key] ?? e.url
    return (
      <button key={e.key} type="button" onClick={() => toggle(e.key)} className="relative rounded-lg overflow-hidden text-left focus:outline-none" style={{ aspectRatio: '1 / 1', background: 'var(--bg-placeholder)', outline: on ? `2px solid ${ACCENT}` : '1px solid var(--border)', outlineOffset: on ? 0 : -1 }} title={e.name ?? ''}>
        <MediaImg src={url} video={e.media === 'video'} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute top-1.5 left-1.5"><CheckButton checked={on} onChange={() => toggle(e.key)} label={on ? '選択を外す' : '選択する'} size={22} stopPropagation /></div>
        {e.media === 'video' && <div className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(0,0,0,0.55)' }}><Play size={11} weight="fill" /></div>}
        {e.isTeam && <span className="absolute bottom-1.5 left-1.5 px-1.5 rounded text-[9px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>チーム</span>}
      </button>
    )
  }
  const section = (label: string, list: Entry[], tabId: TabId, limit?: number) => (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</h3>
        {limit !== undefined && list.length > limit && <button type="button" className="text-[12px] hover:underline" style={{ color: 'var(--text-secondary)' }} onClick={() => setTab(tabId)}>すべて表示</button>}
      </div>
      {list.length === 0
        ? <div className="text-[12px] py-4" style={{ color: 'var(--text-tertiary)' }}>まだありません</div>
        : <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>{(limit !== undefined ? list.slice(0, limit) : list).map(tile)}</div>}
    </section>
  )
  const firstSel = selected.length ? byKey.get(selected[0]) : null

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', zIndex: 20000 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: 'min(1040px, 94vw)', height: 'min(860px, 90vh)', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}>
        <input ref={fileInput} type="file" accept={media === 'video' ? 'video/*' : 'image/*'} multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title ?? `${noun}を追加`}</h2>
          <button type="button" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} onClick={onClose} title="閉じる"><X size={16} /></button>
        </div>
        <div className="flex items-center gap-6 px-6 mt-3 border-b" style={{ borderColor: 'var(--border)' }}>
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className="pb-2 text-[13px] font-medium" style={{ color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: tab === t.id ? '2px solid var(--text-primary)' : '2px solid transparent' }}>{t.label}</button>
          ))}
        </div>
        {/* 本文 */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
          {(tab === 'all' || tab === 'uploads') && (
            <div className="rounded-xl mb-5 flex flex-col items-center justify-center gap-2 py-8" style={{ border: '1px dashed var(--border-active)' }}>
              <button type="button" className="h-9 px-4 rounded-lg text-[13px] font-medium flex items-center gap-2 hover:opacity-90" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
                {uploading > 0 ? <CircleNotch size={16} className="animate-spin" /> : <CloudArrowUp size={16} />}{uploading > 0 ? `アップロード中（${uploading}）` : `${noun}をアップロード`}
              </button>
              <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>または、ここにファイルをドロップしてください。ライブラリに保存され、最終利用から 30 日で自動削除されます</div>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-16" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={20} className="animate-spin" /></div>
          ) : (
            <>
              {tab === 'all' && (<>{section('アップロード', uploadEntries, 'uploads', PREVIEW_COUNT)}{section(genLabel, genEntries, genTabId, PREVIEW_COUNT)}</>)}
              {tab === 'uploads' && section('アップロード', uploadEntries, 'uploads')}
              {(tab === 'gen-image' || tab === 'gen-video') && section(genLabel, genEntries, genTabId)}
            </>
          )}
        </div>
        {/* フッター */}
        <div className="flex items-center gap-3 px-6 py-3 border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
          {firstSel ? <div className="w-10 h-10 rounded-md overflow-hidden shrink-0" style={{ background: 'var(--bg-placeholder)' }}><MediaImg src={signed[firstSel.key] ?? firstSel.url} video={firstSel.media === 'video'} muted className="w-full h-full object-cover" /></div> : <div className="w-10 h-10 rounded-md shrink-0" style={{ background: 'var(--bg-placeholder)' }} />}
          <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{selected.length} 件選択中</div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="h-9 px-4 rounded-lg text-[13px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} onClick={() => setSelected([])} disabled={!selected.length}>すべてクリア</button>
            <button type="button" className="h-9 px-4 rounded-lg text-[13px] font-medium disabled:opacity-50" style={{ background: 'var(--text-primary)', color: 'var(--bg-surface)' }} onClick={confirm} disabled={!selected.length}>
              {multiple ? `${selected.length} 枚の${noun}を追加` : `この${noun}を使う`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
