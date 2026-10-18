// ライブラリ（2026-10-18）: アップロードした素材（自分＋チーム共有）と生成した画像・動画を一覧し、ピン留め・チーム共有・削除ができる。History の置き換え
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleNotch, CloudArrowUp, Download, Play, PushPin, Trash, UsersThree, X } from '@phosphor-icons/react'
import { getMyGenerations, type GenerationWithWorkflow } from '../../lib/api/generations'
import { deleteLibraryItem, libraryDaysLeft, listLibraryItems, signLibraryItems, touchLibraryItems, updateLibraryItem, uploadToLibrary, type LibraryItem, type LibraryMedia } from '../../lib/api/library'
import { formatRelativeJa } from '../../lib/batch/dates'
import { downloadFile } from '../../lib/downloadFile'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../hooks/useToast'
import { useIsMobile } from '../../hooks/useIsMobile'
import { GenerationCard } from './GenerationCard'
import { MediaImg } from '../ui/MediaImg'

const PAGE_SIZE = 30
type Tab = 'uploads' | 'gen-image' | 'gen-video'
type Scope = 'all' | 'mine' | 'team'
const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

export function LibraryPage() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<Tab>('uploads')
  const [scope, setScope] = useState<Scope>('all')
  const [myId, setMyId] = useState<string | null>(null)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [gens, setGens] = useState<GenerationWithWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: { user } }, libs, gs] = await Promise.all([supabase.auth.getUser(), listLibraryItems(), getMyGenerations()])
      setMyId(user?.id ?? null); setItems(libs); setGens(gs); setError(null)
      setSigned(await signLibraryItems(libs))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [tab, scope])

  const uploadsShown = useMemo(() => items.filter((it) => scope === 'all' ? true : scope === 'mine' ? it.user_id === myId : it.user_id !== myId), [items, scope, myId])
  const gensShown = useMemo(() => gens.filter((g) => !!g.output_url && ((isVideoUrl(g.output_url) || g.node_type === 'video-generation') === (tab === 'gen-video'))), [gens, tab])
  const list: Array<LibraryItem | GenerationWithWorkflow> = tab === 'uploads' ? uploadsShown : gensShown
  const total = list.length

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || visibleCount >= total) return
    const obs = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) setVisibleCount((c) => c + PAGE_SIZE) }, { rootMargin: '600px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [visibleCount, total])

  const onFiles = async (files: FileList | null) => {
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (!picked.length) return
    setUploading((n) => n + picked.length)
    const added: LibraryItem[] = []
    for (const f of picked) {
      const media: LibraryMedia = f.type.startsWith('video/') ? 'video' : 'image'
      try { added.push(await uploadToLibrary(f, { media, source: 'library' })) }
      catch (e) { showToast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, 'error') }
      finally { setUploading((n) => n - 1) }
    }
    if (!added.length) return
    const map = await signLibraryItems(added)
    setItems((cur) => [...added, ...cur]); setSigned((cur) => ({ ...cur, ...map }))
  }
  const patchItem = (id: string, patch: Partial<LibraryItem>) => setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  const onPin = async (it: LibraryItem) => { patchItem(it.id, { pinned: !it.pinned }); try { await updateLibraryItem(it.id, { pinned: !it.pinned }) } catch (e) { patchItem(it.id, { pinned: it.pinned }); showToast(e instanceof Error ? e.message : String(e), 'error') } }
  const onShare = async (it: LibraryItem) => { const v = it.visibility === 'team' ? 'private' : 'team'; patchItem(it.id, { visibility: v }); try { await updateLibraryItem(it.id, { visibility: v }) } catch (e) { patchItem(it.id, { visibility: it.visibility }); showToast(e instanceof Error ? e.message : String(e), 'error') } }
  const onDelete = async (it: LibraryItem) => { try { await deleteLibraryItem(it); setItems((cur) => cur.filter((x) => x.id !== it.id)) } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') } }
  const onDownload = async (it: LibraryItem) => { const url = signed[it.id]; if (!url) return; void touchLibraryItems([it.id]); patchItem(it.id, { last_used_at: new Date().toISOString() }); downloadFile(url, it.name ?? `${it.media}-${it.id.slice(0, 8)}`) }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'uploads', label: 'アップロード', count: items.length },
    { id: 'gen-image', label: '生成画像', count: gens.filter((g) => !!g.output_url && !(isVideoUrl(g.output_url) || g.node_type === 'video-generation')).length },
    { id: 'gen-video', label: '生成動画', count: gens.filter((g) => !!g.output_url && (isVideoUrl(g.output_url) || g.node_type === 'video-generation')).length },
  ]

  return (
    <div className="flex flex-col h-full" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (tab === 'uploads') void onFiles(e.dataTransfer.files) }}>
      <input ref={fileInput} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />
      <div className="flex items-center justify-between px-8 py-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>ライブラリ</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>アップロードした素材と生成した画像・動画。どのプロジェクトからも使えます</p>
        </div>
        {tab === 'uploads' && (
          <button type="button" className="h-9 px-4 rounded-lg text-[13px] font-medium text-white flex items-center gap-2 hover:opacity-90 disabled:opacity-50" style={{ background: '#8B5CF6' }} onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
            {uploading > 0 ? <CircleNotch size={14} className="animate-spin" /> : <CloudArrowUp size={14} />}{uploading > 0 ? `アップロード中（${uploading}）` : '追加'}
          </button>
        )}
      </div>
      <div className="flex items-center gap-5 px-8 border-b shrink-0 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className="py-2.5 text-[13px] font-medium whitespace-nowrap flex items-center gap-1.5" style={{ color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: tab === t.id ? '2px solid var(--text-primary)' : '2px solid transparent' }}>
            {t.label}<span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{t.count}</span>
          </button>
        ))}
        {tab === 'uploads' && (
          <div className="ml-auto flex items-center gap-1 py-1.5">
            {([['all', 'すべて'], ['mine', '自分'], ['team', 'チーム共有']] as Array<[Scope, string]>).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setScope(id)} className="h-7 px-2.5 rounded-full text-[11px]" style={{ background: scope === id ? 'var(--bg-elevated)' : 'transparent', color: scope === id ? 'var(--text-primary)' : 'var(--text-secondary)', border: `1px solid ${scope === id ? 'var(--border-active)' : 'transparent'}` }}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-48"><CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} /></div>
        ) : error ? (
          <div className="flex items-center justify-center h-48"><p className="text-[13px]" style={{ color: 'var(--accent-error)' }}>{error}</p></div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>{tab === 'uploads' ? 'まだ素材がありません' : 'まだ生成がありません'}</p>
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{tab === 'uploads' ? '「追加」かドロップでアップロードできます。ノードや App から上げた写真もここに入ります' : '生成した画像や動画がここに並びます'}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {tab === 'uploads'
                ? uploadsShown.slice(0, visibleCount).map((it) => <LibraryCard key={it.id} item={it} url={signed[it.id]} mine={it.user_id === myId} onPin={() => onPin(it)} onShare={() => onShare(it)} onDelete={() => onDelete(it)} onDownload={() => onDownload(it)} />)
                : gensShown.slice(0, visibleCount).map((g) => <GenerationCard key={g.id} generation={g} onDeleted={(id) => setGens((prev) => prev.filter((x) => x.id !== id))} />)}
            </div>
            {visibleCount < total && (
              <div ref={sentinelRef} className="flex items-center justify-center py-6">
                <button onClick={() => setVisibleCount((c) => c + PAGE_SIZE)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                  <CircleNotch size={14} className="animate-spin" />さらに読み込む（残り {total - visibleCount} 件）
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function LibraryCard({ item, url, mine, onPin, onShare, onDelete, onDownload }: { item: LibraryItem; url?: string; mine: boolean; onPin: () => void; onShare: () => void; onDelete: () => void; onDownload: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const days = libraryDaysLeft(item)
  return (
    <div className="group flex flex-col rounded-xl overflow-hidden transition-all duration-150" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--bg-placeholder)' }}>
        <MediaImg src={url ?? ''} video={item.media === 'video'} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
        {item.media === 'video' && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}><Play size={16} weight="fill" color="#fff" /></div></div>}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.5)' }}>
          {confirm ? (
            <>
              <button className="h-8 px-3 rounded-lg text-[12px] font-medium text-white" style={{ background: 'rgba(239,68,68,0.9)' }} onClick={onDelete}>削除</button>
              <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={() => setConfirm(false)} title="やめる"><X size={14} /></button>
            </>
          ) : (
            <>
              <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={onDownload} title="ダウンロード"><Download size={15} weight="bold" /></button>
              {mine && <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: item.pinned ? 'rgba(34,197,94,0.85)' : 'rgba(255,255,255,0.15)' }} onClick={onPin} title={item.pinned ? '保存を解除（最終利用から 30 日で自動削除に戻す）' : '保存（自動削除しない）'}><PushPin size={15} weight={item.pinned ? 'fill' : 'bold'} /></button>}
              {mine && <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: item.visibility === 'team' ? 'rgba(139,92,246,0.85)' : 'rgba(255,255,255,0.15)' }} onClick={onShare} title={item.visibility === 'team' ? 'チーム共有をやめる' : 'チームに共有（メンバーも使える）'}><UsersThree size={15} weight="bold" /></button>}
              {mine && <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(239,68,68,0.85)' }} onClick={() => setConfirm(true)} title="削除"><Trash size={15} weight="bold" /></button>}
            </>
          )}
        </div>
        <div className="absolute bottom-2 left-2 flex items-center gap-1">
          {item.visibility === 'team' && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(139,92,246,0.85)' }}>{mine ? 'チーム共有' : 'チーム'}</span>}
          {item.pinned && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(34,197,94,0.85)' }}>保存</span>}
        </div>
      </div>
      <div className="px-3 py-2">
        <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={item.name ?? ''}>{item.name ?? (item.media === 'video' ? '動画' : '画像')}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{formatRelativeJa(item.created_at)}{item.width && item.height ? ` ・ ${item.width}×${item.height}` : ''}</p>
        <p className="text-[10px] mt-0.5" style={{ color: days !== null && days <= 3 ? '#F59E0B' : 'var(--text-tertiary)' }}>{days === null ? '保存済み（自動削除しない）' : days > 0 ? `最終利用から 30 日で削除（あと ${days} 日）` : 'まもなく削除されます'}</p>
      </div>
    </div>
  )
}
