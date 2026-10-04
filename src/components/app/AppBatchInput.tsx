// App モードの「写真を追加」欄（フェーズ C(c)）。Batch Input ノードと同じ流れ（選択 → アップロード → 一括実行）だが、
// 写真の一覧はこの画面だけで持ち、ワークフロー（canvas_data）には保存しない（共有 App を使うメンバーの写真が
// ワークフローに書き込まれないように）。アップロード先はノードと同じ interactive/<nodeId>/items/。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X, Loader2, Check, AlertCircle, RefreshCw } from 'lucide-react'
import { showToast } from '../../hooks/useToast'
import type { BatchItem } from '../../types/nodes'
import { MAX_BATCH_ITEMS, extractSku, safeFileName, sortAndIndexItems } from '../../lib/batch/items'
import { readImageSize, runWithConcurrency } from '../../lib/batch/upload'
import { interactiveCutoutDir, resolveTeamId, signBatchPaths, uploadBatchObject } from '../../lib/cutout/store'
import type { CreateItemInput } from '../../lib/api/batch'

const ACCENT = '#14B8A6'
const UPLOAD_CONCURRENCY = 3

interface Props {
  nodeId: string                 // Batch Input ノード（アップロード先のフォルダ名）
  skuPattern: string             // ノードの SKU 規則（ここでは変更しない）
  canSubmit: boolean             // 一括実行できるか（ワークフロー未保存などで false）
  onSubmit: (items: CreateItemInput[]) => void
}

/** 投入完了後に一覧を空にするには、親が key を変えて作り直す */
export function AppBatchInput({ nodeId, skuPattern, canSubmit, onSubmit }: Props) {
  const [items, setItems] = useState<BatchItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [dragOver, setDragOver] = useState(false)
  const files = useRef(new Map<string, File>())
  const itemsRef = useRef<BatchItem[]>([])
  itemsRef.current = items
  const uploadingRef = useRef(false)
  const queuedRef = useRef(false)
  const inputId = useMemo(() => `app-batch-input-${nodeId}`, [nodeId])

  const patchItem = useCallback((itemId: string, patch: Partial<BatchItem>) => {
    setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...patch } : i)))
  }, [])

  const uploadPending = useCallback(async () => {
    if (uploadingRef.current) { queuedRef.current = true; return }
    uploadingRef.current = true
    setUploading(true)
    try {
      const teamId = await resolveTeamId()
      const targets = itemsRef.current.filter((i) => (i.status === 'pending' || i.status === 'error') && files.current.has(i.id))
      setProgress({ done: 0, total: targets.length })
      let done = 0
      await runWithConcurrency(targets, UPLOAD_CONCURRENCY, async (it) => {
        const file = files.current.get(it.id)
        if (!file) return
        patchItem(it.id, { status: 'uploading', error: undefined })
        try {
          const size = await readImageSize(file)
          const path = `${interactiveCutoutDir(teamId, nodeId)}/items/app-${it.id}-${Date.now().toString(36)}-${safeFileName(file.name)}`
          await uploadBatchObject(path, file, file.type || 'image/jpeg')
          patchItem(it.id, { status: 'ready', path, width: size?.width, height: size?.height, error: undefined })
          files.current.delete(it.id)
        } catch (e) {
          patchItem(it.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
        }
        done++
        setProgress({ done, total: targets.length })
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'アップロードに失敗しました', 'error')
      setItems((list) => list.map((i) => (i.status === 'uploading' ? { ...i, status: 'error', error: 'アップロード失敗' } : i)))
    } finally {
      uploadingRef.current = false
      setUploading(false)
      setProgress(null)
      if (queuedRef.current) { queuedRef.current = false; void uploadPending() }
    }
  }, [nodeId, patchItem])

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const picked = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    if (!picked.length) return
    const existing = itemsRef.current
    const room = MAX_BATCH_ITEMS - existing.length
    if (room <= 0) { showToast(`最大 ${MAX_BATCH_ITEMS} 枚までです`, 'warning'); return }
    const accepted = picked.slice(0, room)
    if (picked.length > room) showToast(`上限 ${MAX_BATCH_ITEMS} 枚を超える ${picked.length - room} 枚は追加しませんでした`, 'warning')
    const added: BatchItem[] = accepted.map((f) => {
      const itemId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      files.current.set(itemId, f)
      return { id: itemId, index: 0, originalName: f.name, sku: extractSku(f.name, skuPattern), path: null, size: f.size, status: 'pending' }
    })
    const merged = sortAndIndexItems([...existing, ...added])
    itemsRef.current = merged
    setItems(merged)
    void uploadPending()
  }, [skuPattern, uploadPending])

  // アップロード中はページ離脱を警告
  useEffect(() => {
    if (!uploading) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [uploading])

  // サムネイル（署名 URL）
  const readyPathsKey = items.filter((i) => i.status === 'ready' && i.path).map((i) => i.path).join('|')
  useEffect(() => {
    const paths = readyPathsKey ? readyPathsKey.split('|') : []
    if (!paths.length) return
    let alive = true
    signBatchPaths(paths).then((map) => { if (alive) setThumbs((t) => ({ ...t, ...map })) }).catch(() => {})
    return () => { alive = false }
  }, [readyPathsKey])

  const removeItem = useCallback((itemId: string) => {
    files.current.delete(itemId)
    setItems((list) => sortAndIndexItems(list.filter((i) => i.id !== itemId)))
  }, [])
  const clearAll = useCallback(() => { files.current.clear(); setItems([]) }, [])

  const readyItems = items.filter((i) => i.status === 'ready' && i.path)
  const errorCount = items.filter((i) => i.status === 'error').length
  const submit = () => onSubmit(readyItems.map((it) => ({ index: it.index, originalName: it.originalName, sku: it.sku, interactivePath: it.path as string, width: it.width, height: it.height })))

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        className="flex flex-col items-center justify-center gap-1 rounded-xl py-6 cursor-pointer transition-colors"
        style={{ border: dragOver ? `1px dashed ${ACCENT}` : '1px dashed var(--border-active)', background: dragOver ? 'rgba(20,184,166,0.08)' : 'var(--bg-canvas)' }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setDragOver(true) } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
      >
        <Upload size={20} style={{ color: ACCENT }} />
        <span className="text-[13px] font-medium" style={{ color: ACCENT }}>写真をドロップ / クリックして選択</span>
        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>最大 {MAX_BATCH_ITEMS} 枚・JPEG / PNG / WebP</span>
      </label>
      <input id={inputId} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />

      <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        SKU はファイル名から <code className="font-mono" style={{ color: 'var(--text-secondary)' }}>{skuPattern}</code> で抜き出します（一致しなければ拡張子を除いたファイル名）。規則を変えるにはキャンバスの Batch Input ノードで。
      </div>

      <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <span>{items.length} / {MAX_BATCH_ITEMS} 枚・準備完了 {readyItems.length}{errorCount ? `・失敗 ${errorCount}` : ''}</span>
        {items.length > 0 && <button className="text-[11px] hover:underline" style={{ color: 'var(--text-tertiary)' }} onClick={clearAll} disabled={uploading}>すべて削除</button>}
      </div>
      {uploading && progress && (
        <div>
          <div className="h-1.5 rounded overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
            <div className="h-full transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: ACCENT }} />
          </div>
          <div className="text-[11px] mt-1" style={{ color: ACCENT }}>アップロード中 {progress.done} / {progress.total}（この間はページを離れないでください）</div>
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-lg overflow-auto" style={{ border: '1px solid var(--border)', maxHeight: 360 }}>
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
              <div className="w-9 h-9 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                {it.path && thumbs[it.path] ? <img src={thumbs[it.path]} alt="" className="w-full h-full object-cover" draggable={false} /> : <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{it.index}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] truncate" style={{ color: 'var(--text-primary)' }} title={it.originalName}>{it.index}. {it.originalName}</div>
                <div className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>SKU: {it.sku}{it.width ? `・${it.width}×${it.height}` : ''}{it.error ? `・${it.error}` : ''}</div>
              </div>
              <div className="shrink-0 flex items-center gap-0.5">
                {it.status === 'uploading' && <Loader2 size={12} className="animate-spin" style={{ color: ACCENT }} />}
                {it.status === 'ready' && <Check size={12} style={{ color: '#22C55E' }} />}
                {it.status === 'error' && (
                  <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]" title="再試行" onClick={() => void uploadPending()}>
                    {files.current.has(it.id) ? <RefreshCw size={12} style={{ color: '#EF4444' }} /> : <AlertCircle size={12} style={{ color: '#EF4444' }} />}
                  </button>
                )}
                <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-tertiary)' }} title="一覧から外す" onClick={() => removeItem(it.id)}><X size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        className="h-9 w-full rounded-lg text-[12px] font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ background: ACCENT }}
        disabled={!canSubmit || readyItems.length === 0 || uploading}
        title={!canSubmit ? 'この App ではまだ処理を始められません（ワークフローが未保存です）' : uploading ? 'アップロードが終わるまで待ってください' : readyItems.length === 0 ? '準備完了の写真がありません' : '準備完了の写真すべてを処理します'}
        onClick={submit}
      >
        {readyItems.length} 枚を処理する
      </button>
      <div className="text-[11px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
        処理は裏側で進み、右の欄に結果が出ます。ここに並ぶ写真はこの画面を離れると消えますが、結果は残ります。
      </div>
    </div>
  )
}
