// ライブラリ（2026-10-18）: アップロードした素材（自分＋チーム共有）と生成した画像・動画を一覧し、ピン留め・チーム共有・削除ができる。History の置き換え
// 生成画像タブには一括処理（切り抜き等）の結果が「1 ジョブ = 1 フォルダ」のカードで混ざる（2026-10-31）。クリックで中身のダイアログ
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowSquareOut, ArrowsOut, CircleNotch, CloudArrowUp, Download, PencilSimple, Play, PushPin, Trash, UserCircle, UsersThree, X } from '@phosphor-icons/react'
import { VideoLightbox } from '../library/VideoLightbox'
import { useNavigate } from 'react-router'
import { getMyGenerations, type GenerationWithWorkflow } from '../../lib/api/generations'
import { deleteLibraryItem, libraryDaysLeft, listLibraryItems, signLibraryItems, touchLibraryItems, updateLibraryItem, uploadToLibrary, type LibraryItem, type LibraryMedia } from '../../lib/api/library'
import { formatRelativeJa } from '../../lib/batch/dates'
import { downloadFile } from '../../lib/downloadFile'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../hooks/useToast'
import { useIsMobile } from '../../hooks/useIsMobile'
import { GenerationCard } from './GenerationCard'
import { MediaImg } from '../ui/MediaImg'
import { ModelEditorDialog } from '../library/ModelEditorDialog'
import { CUT_ROLES, FRONTAL_ROLE } from '../../lib/video/productVideo'
import { deleteLibraryModel, fetchLibraryItemsByIds, listLibraryModels, modelItemIds, modelsUsingItem, shareLibraryItemsWithTeam, updateLibraryModel, type LibraryModel } from '../../lib/api/libraryModels'
import { listBatchVideos, signBatchVideos, type BatchVideo } from '../../lib/api/batchVideos'
import { fetchFolderPreviews, listBatchFolders, signFolderPreviews, type BatchFolder } from '../../lib/api/batchFolders'
import { PREVIEW_ITEMS } from '../../lib/batch/folders'
import { BatchFolderCard } from '../library/BatchFolderCard'
import { BatchFolderDialog } from '../library/BatchFolderDialog'

const PAGE_SIZE = 30
type Tab = 'uploads' | 'models' | 'gen-image' | 'gen-video'
type Scope = 'all' | 'mine' | 'team'
const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

export function LibraryPage() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('uploads')
  const [scope, setScope] = useState<Scope>('all')
  const [myId, setMyId] = useState<string | null>(null)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [gens, setGens] = useState<GenerationWithWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [models, setModels] = useState<LibraryModel[]>([])
  const [batchVideos, setBatchVideos] = useState<BatchVideo[]>([])   // 商品動画 App の結果（生成動画タブに並べる）
  const [folders, setFolders] = useState<BatchFolder[]>([])          // 写真の一括処理（生成画像タブにフォルダとして並べる）
  const [folderUrls, setFolderUrls] = useState<Record<string, string>>({})   // フォルダカードの重ねサムネイル（batch パス → 署名 URL）
  const [folderOpen, setFolderOpen] = useState<BatchFolder | null>(null)
  const [modelThumbs, setModelThumbs] = useState<Record<string, string>>({})   // model id → 正面の署名 URL
  const [editor, setEditor] = useState<{ open: boolean; model: LibraryModel | null }>({ open: false, model: null })
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: { user } }, libs, gs, ms, bvs, fds] = await Promise.all([
        supabase.auth.getUser(), listLibraryItems(), getMyGenerations(), listLibraryModels(), listBatchVideos().catch(() => [] as BatchVideo[]), listBatchFolders().catch(() => [] as BatchFolder[]),
      ])
      setMyId(user?.id ?? null); setItems(libs); setGens(gs); setModels(ms); setBatchVideos(bvs); setFolders(fds); setError(null)
      const [libMap, bvMap, fdMap] = await Promise.all([signLibraryItems(libs), signBatchVideos(bvs), signFolderPreviews(fds)])
      const merged: Record<string, string> = { ...libMap }
      for (const v of bvs) if (bvMap[v.id]) merged[`batch:${v.id}`] = bvMap[v.id]
      setSigned(merged); setFolderUrls(fdMap)
      await refreshModelThumbs(ms)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  async function refreshModelThumbs(ms: LibraryModel[]) {
    const fronts = ms.map((m) => m.cuts[FRONTAL_ROLE]).filter((v): v is string => !!v)
    if (!fronts.length) { setModelThumbs({}); return }
    const fitems = await fetchLibraryItemsByIds(fronts)
    const map = await signLibraryItems(fitems)
    const next: Record<string, string> = {}
    for (const m of ms) { const id = m.cuts[FRONTAL_ROLE]; if (id && map[id]) next[m.id] = map[id] }
    setModelThumbs(next)
  }
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [tab, scope])

  const uploadsShown = useMemo(() => items.filter((it) => scope === 'all' ? true : scope === 'mine' ? it.user_id === myId : it.user_id !== myId), [items, scope, myId])
  const gensShown = useMemo(() => gens.filter((g) => !!g.output_url && ((isVideoUrl(g.output_url) || g.node_type === 'video-generation') === (tab === 'gen-video'))), [gens, tab])
  // 生成動画 = キャンバスの生成（generations）＋ 商品動画 App の結果（batch）を日時順に
  const videoEntries = useMemo(() => {
    if (tab !== 'gen-video') return [] as Array<{ kind: 'gen'; date: string; g: GenerationWithWorkflow } | { kind: 'batch'; date: string; v: BatchVideo }>
    return [
      ...gensShown.map((g) => ({ kind: 'gen' as const, date: g.created_at, g })),
      ...batchVideos.map((v) => ({ kind: 'batch' as const, date: v.completedAt, v })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [tab, gensShown, batchVideos])
  // 生成画像 = キャンバスの生成（generations）＋ 写真の一括処理のフォルダ（1 ジョブ = 1 カード）を日時順に
  const imageEntries = useMemo(() => {
    if (tab !== 'gen-image') return [] as Array<{ kind: 'gen'; date: string; g: GenerationWithWorkflow } | { kind: 'folder'; date: string; f: BatchFolder }>
    return [
      ...gensShown.map((g) => ({ kind: 'gen' as const, date: g.created_at, g })),
      ...folders.map((f) => ({ kind: 'folder' as const, date: f.createdAt, f })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [tab, gensShown, folders])
  const total = tab === 'uploads' ? uploadsShown.length : tab === 'models' ? models.length : tab === 'gen-video' ? videoEntries.length : imageEntries.length
  // フォルダを閉じたら、開いたことで描かれたサムネイルをカードにも反映する（記録は閉じた後も少しずつ進むので、揃うまで数回取り直す）
  const onFolderClosed = useCallback(() => {
    const f = folderOpen
    setFolderOpen(null)
    const want = Math.min(PREVIEW_ITEMS, f?.itemCount ?? 0)
    if (!f || f.previews.length >= want) return
    void (async () => {
      for (const delay of [1500, 3000, 4000]) {
        await new Promise((r) => setTimeout(r, delay))
        const previews = (await fetchFolderPreviews([f.jobId]).catch(() => ({} as Record<string, string[]>)))[f.jobId] ?? []
        if (!previews.length) continue
        const urls = await signFolderPreviews([{ previews }])
        setFolders((cur) => cur.map((x) => (x.jobId === f.jobId ? { ...x, previews } : x)))
        setFolderUrls((cur) => ({ ...cur, ...urls }))
        if (previews.length >= want) break
      }
    })()
  }, [folderOpen])
  const openFolderResults = useCallback((f: BatchFolder) => navigate(f.workflowId ? `/app/${f.workflowId}?job=${f.jobId}` : `/jobs/${f.jobId}`), [navigate])

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
  const onDelete = async (it: LibraryItem) => {
    const used = modelsUsingItem(models, it.id)
    if (used.length) { showToast(`モデル「${used[0].name}」で使っています。先にモデルから外してください`, 'warning'); return }
    try { await deleteLibraryItem(it); setItems((cur) => cur.filter((x) => x.id !== it.id)) } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
  }
  const onModelSaved = (m: LibraryModel) => { setModels((cur) => { const i = cur.findIndex((x) => x.id === m.id); const next = i >= 0 ? cur.map((x) => (x.id === m.id ? m : x)) : [m, ...cur]; void refreshModelThumbs(next); return next }); void load() }
  const onModelShare = async (m: LibraryModel) => { const v = m.visibility === 'team' ? 'private' : 'team'; setModels((cur) => cur.map((x) => (x.id === m.id ? { ...x, visibility: v } : x))); try { await updateLibraryModel(m.id, { visibility: v }); if (v === 'team') { await shareLibraryItemsWithTeam(modelItemIds(m)); void load() } } catch (e) { setModels((cur) => cur.map((x) => (x.id === m.id ? { ...x, visibility: m.visibility } : x))); showToast(e instanceof Error ? e.message : String(e), 'error') } }
  const onModelDelete = async (m: LibraryModel) => { try { await deleteLibraryModel(m.id); setModels((cur) => cur.filter((x) => x.id !== m.id)) } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') } }
  const onDownload = async (it: LibraryItem) => { const url = signed[it.id]; if (!url) return; void touchLibraryItems([it.id]); patchItem(it.id, { last_used_at: new Date().toISOString() }); downloadFile(url, it.name ?? `${it.media}-${it.id.slice(0, 8)}`) }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'uploads', label: 'アップロード', count: items.length },
    { id: 'models', label: 'モデル', count: models.length },
    { id: 'gen-image', label: '生成画像', count: gens.filter((g) => !!g.output_url && !(isVideoUrl(g.output_url) || g.node_type === 'video-generation')).length + folders.length },
    { id: 'gen-video', label: '生成動画', count: gens.filter((g) => !!g.output_url && (isVideoUrl(g.output_url) || g.node_type === 'video-generation')).length + batchVideos.length },
  ]

  return (
    <div className="flex flex-col h-full" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (tab === 'uploads') void onFiles(e.dataTransfer.files) }}>
      <input ref={fileInput} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />
      <div className="flex items-center justify-between px-8 py-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>ライブラリ</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>アップロードした素材と生成した画像・動画。どのプロジェクトからも使えます</p>
        </div>
        {tab === 'models' && (
          <button type="button" className="h-9 px-4 rounded-lg text-[13px] font-medium text-white flex items-center gap-2 hover:opacity-90" style={{ background: '#EC4899' }} onClick={() => setEditor({ open: true, model: null })}>
            <UserCircle size={14} />モデルを登録
          </button>
        )}
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
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>{tab === 'uploads' ? 'まだ素材がありません' : tab === 'models' ? 'まだモデルがありません' : 'まだ生成がありません'}</p>
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{tab === 'uploads' ? '「追加」かドロップでアップロードできます。ノードや App から上げた写真もここに入ります' : tab === 'models' ? '「モデルを登録」で、同じ人物の 4 方向などのカットに名前を付けてまとめられます。商品動画 App で一度に入れられます' : tab === 'gen-image' ? '生成した画像と、切り抜きなど一括処理の結果（フォルダ）がここに並びます' : '生成した動画と商品動画がここに並びます'}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {tab === 'uploads'
                ? uploadsShown.slice(0, visibleCount).map((it) => <LibraryCard key={it.id} item={it} url={signed[it.id]} mine={it.user_id === myId} onPin={() => onPin(it)} onShare={() => onShare(it)} onDelete={() => onDelete(it)} onDownload={() => onDownload(it)} />)
                : tab === 'models'
                  ? models.slice(0, visibleCount).map((m) => <ModelCard key={m.id} model={m} url={modelThumbs[m.id]} mine={m.user_id === myId} onEdit={() => setEditor({ open: true, model: m })} onShare={() => onModelShare(m)} onDelete={() => onModelDelete(m)} />)
                  : tab === 'gen-video'
                    ? videoEntries.slice(0, visibleCount).map((e) => e.kind === 'gen'
                      ? <GenerationCard key={e.g.id} generation={e.g} onDeleted={(id) => setGens((prev) => prev.filter((x) => x.id !== id))} />
                      : <BatchVideoCard key={e.v.id} video={e.v} url={signed[`batch:${e.v.id}`]} mine={!e.v.createdBy || e.v.createdBy === myId} onOpen={() => navigate(e.v.workflowId ? `/app/${e.v.workflowId}?job=${e.v.jobId}` : `/jobs/${e.v.jobId}`)} />)
                    : imageEntries.slice(0, visibleCount).map((e) => e.kind === 'gen'
                      ? <GenerationCard key={e.g.id} generation={e.g} onDeleted={(id) => setGens((prev) => prev.filter((x) => x.id !== id))} />
                      : <BatchFolderCard key={`folder:${e.f.jobId}`} folder={e.f} urls={e.f.previews.map((p) => folderUrls[p]).filter((u): u is string => !!u)} mine={!e.f.createdBy || e.f.createdBy === myId} onOpen={() => setFolderOpen(e.f)} onOpenResults={() => openFolderResults(e.f)} />)}
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
      <ModelEditorDialog open={editor.open} model={editor.model} onClose={() => setEditor({ open: false, model: null })} onSaved={onModelSaved} />
      <BatchFolderDialog open={!!folderOpen} folder={folderOpen} mode="browse" onClose={onFolderClosed} onOpenResults={() => { if (folderOpen) openFolderResults(folderOpen) }} />
    </div>
  )
}

/** 商品動画（一括実行の終端の動画）のカード。ボタンの並びは生成動画のカード（GenerationCard）と同じ: ダウンロード / 拡大表示 / …（保存・削除は処理の履歴の画面で）。クリックで拡大表示 */
function BatchVideoCard({ video, url, mine, onOpen }: { video: BatchVideo; url?: string; mine: boolean; onOpen: () => void }) {
  const [lightbox, setLightbox] = useState(false)
  const download = async () => { if (!url) return; downloadFile(url, `${video.sku || 'video'}.mp4`) }
  return (
    <div className="group flex flex-col rounded-xl overflow-hidden transition-all duration-150 cursor-pointer" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} onClick={() => { if (url) setLightbox(true) }}>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--bg-placeholder)' }}>
        <MediaImg src={url ?? ''} video muted playsInline className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={(e) => { e.stopPropagation(); void download() }} title="ダウンロード"><Download size={15} weight="bold" /></button>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={(e) => { e.stopPropagation(); if (url) setLightbox(true) }} title="拡大表示"><ArrowsOut size={15} weight="bold" /></button>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={(e) => { e.stopPropagation(); onOpen() }} title="結果の画面で開く"><ArrowSquareOut size={15} weight="bold" /></button>
        </div>
        {lightbox && url && <VideoLightbox url={url} onClose={() => setLightbox(false)} onDownload={() => void download()} />}
        <div className="absolute bottom-2 left-2 flex items-center gap-1">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(236,72,153,0.85)' }}>商品動画</span>
          {!mine && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>チーム</span>}
        </div>
      </div>
      <div className="px-3 py-2">
        <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={video.sku}>{video.sku || '動画'}</p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{video.jobName}{video.completedAt ? ` ・ ${formatRelativeJa(video.completedAt)}` : ''}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>処理の履歴と一緒に保持（削除は履歴から）</p>
      </div>
    </div>
  )
}

function ModelCard({ model, url, mine, onEdit, onShare, onDelete }: { model: LibraryModel; url?: string; mine: boolean; onEdit: () => void; onShare: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const roles = CUT_ROLES.filter((r) => !!model.cuts[r.id])
  return (
    <div className="group flex flex-col rounded-xl overflow-hidden transition-all duration-150" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--bg-placeholder)' }}>
        <MediaImg src={url ?? ''} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.5)' }}>
          {confirm ? (
            <>
              <button className="h-8 px-3 rounded-lg text-[12px] font-medium text-white" style={{ background: 'rgba(239,68,68,0.9)' }} onClick={onDelete}>削除</button>
              <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={() => setConfirm(false)} title="やめる"><X size={14} /></button>
            </>
          ) : mine ? (
            <>
              <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={onEdit} title="編集"><PencilSimple size={15} weight="bold" /></button>
              <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: model.visibility === 'team' ? 'rgba(139,92,246,0.85)' : 'rgba(255,255,255,0.15)' }} onClick={onShare} title={model.visibility === 'team' ? 'チーム共有をやめる（写真の共有はそのまま）' : 'チームに共有（モデルと写真をメンバーも使える）'}><UsersThree size={15} weight="bold" /></button>
              <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(239,68,68,0.85)' }} onClick={() => setConfirm(true)} title="削除（写真はライブラリに残ります）"><Trash size={15} weight="bold" /></button>
            </>
          ) : null}
        </div>
        <div className="absolute bottom-2 left-2 flex items-center gap-1">
          {model.visibility === 'team' && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(139,92,246,0.85)' }}>{mine ? 'チーム共有' : 'チーム'}</span>}
        </div>
      </div>
      <div className="px-3 py-2">
        <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={model.note ?? ''}>{model.name}</p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{roles.map((r) => r.label).join('・')}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{formatRelativeJa(model.updated_at)}{model.note ? ` ・ ${model.note}` : ''}</p>
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
