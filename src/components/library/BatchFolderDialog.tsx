// 一括処理のフォルダの中身（2026-10-31）: 確認グリッドと同じ列（切り抜き / バリアント / 生成結果）の最終結果を写真ごとに並べる。
// - browse（ライブラリから）: クリックで拡大、タイル右上でフル解像度をダウンロード、「結果の画面で開く」
// - pick（「画像を追加」ダイアログから）: 複数選択 → 「n 枚の画像を追加」。1 枚だけ受ける入力ではクリックで即採用
// サムネイルは確認グリッドと同じ仕組み（reviewStore: 記録済みなら署名、無ければ Worker で描いて保存）。このダイアログは自分の store を 1 つ持つ
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowSquareOut, CircleNotch, Download, X } from '@phosphor-icons/react'
import type { BatchItemRow } from '../../types/batch'
import { CheckButton } from '../ui/CheckButton'
import { Thumb } from '../jobs/review/ReviewGrid'
import { ReviewLightbox } from '../jobs/review/ReviewLightbox'
import { BG_STYLE } from '../jobs/review/reviewStyles'
import { completedResultOf, createReviewStoreHook, renderableOf } from '../../lib/review/reviewStore'
import { isResultKey, resultNodeIdOf, thumbKey } from '../../lib/review/model'
import { loadFolderContents, resolveFolderImages, type BatchFolder, type FolderContents, type FolderImage, type ResolveProgress } from '../../lib/api/batchFolders'
import { folderImageName, folderTitle } from '../../lib/batch/folders'
import { signBatchPath } from '../../lib/cutout/store'
import { downloadBlob } from '../../lib/export/zip'
import { showToast } from '../../hooks/useToast'

const ACCENT = '#8B5CF6'

interface Props {
  open: boolean
  folder: BatchFolder | null
  mode: 'browse' | 'pick'
  multiple?: boolean            // pick: 複数選択。false ならクリックで即採用
  zIndex?: number               // 「画像を追加」ダイアログ（20000）の上に重ねる
  onClose: () => void
  onPick?: (images: FolderImage[]) => void
  onOpenResults?: () => void
}

export function BatchFolderDialog({ open, folder, mode, multiple = true, zIndex = 20010, onClose, onPick, onOpenResults }: Props) {
  const store = useMemo(() => createReviewStoreHook(), [])
  const [contents, setContents] = useState<FolderContents | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [resolving, setResolving] = useState<ResolveProgress | null>(null)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const thumbs = store((s) => s.thumbs)
  const activeKey = store((s) => s.activeKey)
  const setActiveKey = store((s) => s.setActiveKey)
  const lightbox = store((s) => s.lightbox)
  const setLightbox = store((s) => s.setLightbox)
  const bg = store((s) => s.bg)
  const setBg = store((s) => s.setBg)
  const progress = store((s) => s.progress)
  const jobId = open ? folder?.jobId ?? null : null

  useEffect(() => () => store.getState().close(), [store])

  // 開いたら読み込み → 確認グリッドと同じ sync（記録済みサムネイルは署名、無ければ描く）。閉じたら描画を止めて解放
  useEffect(() => {
    if (!jobId) return
    let alive = true
    cancelRef.current = false
    setLoading(true); setError(null); setContents(null); setSelected(new Set()); setResolving(null)
    store.getState().open(jobId)
    loadFolderContents(jobId)
      .then((c) => {
        if (!alive) return
        if (!c) { setError('この処理は見つかりません（削除された可能性があります）'); return }
        setContents(c)
        if (c.columns.length) store.getState().setActiveKey(c.columns[0].key)
        void store.getState().sync(c.ctx)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; cancelRef.current = true; store.getState().close() }
  }, [jobId, store])

  // Esc で閉じる（capture で止めて、下の「画像を追加」ダイアログまで閉じない。拡大表示中はそちらが受ける）
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || store.getState().lightbox || cancelRef.current) return
      e.preventDefault(); e.stopPropagation(); onClose()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [open, onClose, store])

  const columns = contents?.columns ?? []
  const col = columns.find((c) => c.key === activeKey) ?? columns[0] ?? null
  const items = contents?.items ?? []
  const available = useCallback((item: BatchItemRow, key: string) => {
    if (!contents) return false
    return isResultKey(key) ? !!completedResultOf(contents.ctx, item.id, resultNodeIdOf(key)) : !!renderableOf(contents.ctx, item)
  }, [contents])
  const toggle = useCallback((tk: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(tk)) next.delete(tk); else next.add(tk); return next }), [])

  // 選んだタイルを画像にして渡す（レイアウト系はフル解像度を描いて保存）。中止は次のタイルから
  const deliver = useCallback(async (keys: string[]) => {
    if (!contents || !onPick || !keys.length) return
    cancelRef.current = false
    setResolving({ done: 0, total: keys.length })
    try {
      const r = await resolveFolderImages(contents, store, keys, { onProgress: setResolving, isCancelled: () => cancelRef.current })
      for (const w of r.warnings.slice(0, 3)) showToast(w, 'warning')
      if (r.cancelled) { showToast('中止しました', 'warning'); return }
      if (!r.images.length) { showToast('使える画像がありませんでした', 'error'); return }
      onPick(r.images)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally { setResolving(null) }
  }, [contents, onPick, store])

  const download = useCallback(async (item: BatchItemRow, key: string, colName: string) => {
    try {
      const r = await store.getState().renderFull(item.id, key)
      downloadBlob(r.blob, `${folderImageName(item.sku, colName)}.${r.format === 'jpeg' ? 'jpg' : r.format}`)
    } catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
  }, [store])

  // 拡大表示: 元画像（比較用）の署名
  const lbItem = lightbox ? items.find((i) => i.id === lightbox.itemId) ?? null : null
  const lbIdx = lbItem ? items.findIndex((i) => i.id === lbItem.id) : -1
  useEffect(() => {
    const path = lbItem?.source_path ?? lbItem?.interactive_path ?? null
    if (!path) { setOriginalUrl(null); return }
    let alive = true
    signBatchPath(path).then((u) => { if (alive) setOriginalUrl(u) }).catch(() => { if (alive) setOriginalUrl(null) })
    return () => { alive = false }
  }, [lbItem])
  const renderFull = useCallback((itemId: string, variantKey: string) => store.getState().renderFull(itemId, variantKey), [store])

  if (!open || !folder) return null
  const busy = !!resolving
  const stop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }

  const tile = (item: BatchItemRow) => {
    if (!col || !contents) return null
    const key = col.key
    const tk = thumbKey(item.id, key)
    const ok = available(item, key)
    const on = selected.has(tk)
    const task = isResultKey(key) ? completedResultOf(contents.ctx, item.id, resultNodeIdOf(key)) : null
    const w = col.kind === 'variant' ? col.width : task?.result_meta?.width ?? item.width ?? null
    const h = col.kind === 'variant' ? col.height : task?.result_meta?.height ?? item.height ?? null
    const onClick = () => {
      if (!ok || busy) return
      if (mode === 'browse') setLightbox({ itemId: item.id, variantKey: key })
      else if (multiple) toggle(tk)
      else void deliver([tk])
    }
    return (
      <div key={item.id} className="flex flex-col gap-1 min-w-0">
        <div
          role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
          onDoubleClick={() => { if (ok && mode === 'pick' && multiple) setLightbox({ itemId: item.id, variantKey: key }) }}
          className="group relative rounded-lg overflow-hidden focus:outline-none"
          style={{ ...BG_STYLE.checker, aspectRatio: w && h ? `${w} / ${h}` : '1 / 1', outline: on ? `2px solid ${ACCENT}` : '1px solid var(--border)', outlineOffset: on ? 0 : -1, cursor: ok && !busy ? 'pointer' : 'default', opacity: ok ? 1 : 0.6 }}
          title={ok ? (mode === 'browse' ? 'クリックで拡大' : multiple ? 'クリックで選択（ダブルクリックで拡大）' : 'クリックでこの画像を使う') : 'この列の結果はありません'}
        >
          <div className="absolute inset-0"><Thumb thumb={thumbs[tk]} item={item} /></div>
          {mode === 'pick' && multiple && ok && <div className="absolute top-1.5 left-1.5"><CheckButton checked={on} onChange={() => toggle(tk)} label={on ? '選択を外す' : '選択する'} size={22} stopPropagation /></div>}
          {mode === 'browse' && ok && (
            <button type="button" className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={(e) => { e.stopPropagation(); void download(item, key, col.name) }} title="ダウンロード（フル解像度）"><Download size={14} weight="bold" /></button>
          )}
        </div>
        <div className="flex items-baseline gap-2 min-w-0 px-0.5">
          <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={`${item.sort_order}. ${item.sku}（${item.original_filename}）`}>{item.sort_order}. {item.sku}</span>
          <span className="ml-auto text-[10px] tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>{w && h ? `${w}×${h}` : ''}</span>
        </div>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', zIndex }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }} onDragOver={stop} onDrop={stop}>
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ width: 'min(1040px, 94vw)', height: 'min(860px, 90vh)', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onDragOver={stop} onDrop={stop}>
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-6 pt-5">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={folder.jobName}>{folderTitle(folder)}</h2>
            <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
              一括処理 ・ {folder.itemCount} 枚{contents && contents.items.length !== folder.itemCount ? `（結果あり ${contents.items.length} 枚）` : ''} ・ 処理の履歴と一緒に保持（削除は履歴から）
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {onOpenResults && (
              <button type="button" className="h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:opacity-90" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} onClick={onOpenResults} disabled={busy}>
                <ArrowSquareOut size={14} />結果の画面で開く
              </button>
            )}
            <button type="button" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} onClick={onClose} title="閉じる（Esc）" disabled={busy}><X size={16} /></button>
          </div>
        </div>
        {/* 列のタブ（確認グリッドと同じ並び。1 列だけなら出さない） */}
        <div className="flex items-center gap-6 px-6 mt-3 border-b overflow-x-auto" style={{ borderColor: 'var(--border)', minHeight: columns.length > 1 ? undefined : 8 }}>
          {columns.length > 1 && columns.map((c) => (
            <button key={c.key} type="button" onClick={() => setActiveKey(c.key)} className="pb-2 text-[13px] font-medium whitespace-nowrap flex items-center gap-1.5" style={{ color: c.key === col?.key ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: c.key === col?.key ? '2px solid var(--text-primary)' : '2px solid transparent' }}>
              {c.name}<span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{c.size}</span>
            </button>
          ))}
        </div>
        {/* 本文 */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={20} className="animate-spin" /></div>
          ) : error ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--accent-error)' }}>{error}</div>
          ) : !col || items.length === 0 ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--text-tertiary)' }}>この処理に結果はありません</div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>{items.map(tile)}</div>
          )}
        </div>
        {/* フッター */}
        <div className="flex items-center gap-3 px-6 py-3 border-t text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          {resolving ? (
            <>
              <CircleNotch size={16} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />
              <span>画像を用意しています（{resolving.done} / {resolving.total}）</span>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>切り抜き・バリアントはフル解像度をここで描いて保存します</span>
              <button type="button" className="ml-auto h-9 px-4 rounded-lg text-[13px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} onClick={() => { cancelRef.current = true }}>中止</button>
            </>
          ) : mode === 'pick' ? (
            multiple ? (
              <>
                <span>{selected.size} 件選択中</span>
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>列を切り替えても選択は残ります</span>
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" className="h-9 px-4 rounded-lg text-[13px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} onClick={() => setSelected(new Set())} disabled={!selected.size}>すべてクリア</button>
                  <button type="button" className="h-9 px-4 rounded-lg text-[13px] font-medium disabled:opacity-50" style={{ background: 'var(--text-primary)', color: 'var(--bg-surface)' }} onClick={() => void deliver([...selected])} disabled={!selected.size}>{selected.size} 枚の画像を追加</button>
                </div>
              </>
            ) : (
              <span style={{ color: 'var(--text-secondary)' }}>クリックした画像をそのまま使います</span>
            )
          ) : (
            <>
              <span>{progress.running ? `サムネイルを描画中（${progress.done} / ${progress.total}）` : `${items.length} 枚`}</span>
              <span className="ml-auto text-[11px]" style={{ color: 'var(--text-tertiary)' }}>クリックで拡大 ・ タイル右上でダウンロード ・ まとめて書き出すには「結果の画面で開く」</span>
            </>
          )}
        </div>
      </div>
      {lightbox && lbItem && (
        <ReviewLightbox
          item={lbItem} variantKey={lightbox.variantKey} columns={columns} thumb={thumbs[thumbKey(lbItem.id, lightbox.variantKey)]}
          bg={bg} onBg={setBg} originalUrl={originalUrl} renderFull={renderFull}
          onClose={() => setLightbox(null)}
          onPrev={() => { const n = items[lbIdx - 1]; if (n) setLightbox({ itemId: n.id, variantKey: lightbox.variantKey }) }}
          onNext={() => { const n = items[lbIdx + 1]; if (n) setLightbox({ itemId: n.id, variantKey: lightbox.variantKey }) }}
          onVariant={(key) => { setLightbox({ itemId: lbItem.id, variantKey: key }); setActiveKey(key) }}
          checked={selected.has(thumbKey(lbItem.id, lightbox.variantKey))} onToggleCheck={() => toggle(thumbKey(lbItem.id, lightbox.variantKey))}
          hasPrev={lbIdx > 0} hasNext={lbIdx >= 0 && lbIdx < items.length - 1}
          zIndex={zIndex + 10} hideCheck={mode === 'browse' || !multiple}
        />
      )}
    </div>,
    document.body,
  )
}
