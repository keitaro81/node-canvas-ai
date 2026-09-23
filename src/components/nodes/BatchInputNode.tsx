import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Images, Upload, X, RefreshCw, Star, Loader2, AlertCircle, Check } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { useCanvasStore } from '../../stores/canvasStore'
import { showToast } from '../../hooks/useToast'
import type { NodeData, BatchItem } from '../../types/nodes'
import {
  MAX_BATCH_ITEMS, applySkuPattern, compileSkuPattern, extractSku, itemInfoOf, normalizeBatchInputParams, safeFileName, sortAndIndexItems,
} from '../../lib/batch/items'
import { readImageSize, runWithConcurrency } from '../../lib/batch/upload'
import { interactiveCutoutDir, resolveTeamId, signBatchPath, signBatchPaths, uploadBatchObject } from '../../lib/cutout/store'
import { Field } from './pp/controls'
import { CTRL, INPUT_STYLE, PP_ACCENT, stopKeys } from './pp/styles'

// アップロード用の File はセッション内だけ保持する（canvas_data には保存しない）
const pendingFiles = new Map<string, Map<string, File>>()
const UPLOAD_CONCURRENCY = 3

function BatchInputNodeInner(props: NodeProps) {
  const { id, data } = props
  const nodeData = data as unknown as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const params = useMemo(() => normalizeBatchInputParams(nodeData.params), [nodeData.params])
  const items = useMemo(() => (Array.isArray(nodeData.items) ? (nodeData.items as BatchItem[]) : []), [nodeData.items])
  const currentItemId = typeof nodeData.currentItemId === 'string' ? nodeData.currentItemId : null

  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [dragOver, setDragOver] = useState(false)
  const uploadingRef = useRef(false)
  const queuedRef = useRef(false)

  const getData = useCallback(() => useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as NodeData | undefined, [id])
  const getItems = useCallback(() => ((getData()?.items as BatchItem[] | undefined) ?? []), [getData])

  /** 対話実行で流す 1 枚（★）の出力 URL とアイテム情報を同期する。 */
  const syncCurrent = useCallback(async () => {
    const d = getData()
    const list = ((d?.items as BatchItem[] | undefined) ?? [])
    const cur = list.find((i) => i.id === d?.currentItemId) ?? list[0]
    if (!cur) { updateNode(id, { currentItemId: null, itemInfo: undefined, output: undefined, status: 'idle' }); return }
    const output = cur.status === 'ready' && cur.path ? ((await signBatchPath(cur.path)) ?? undefined) : undefined
    updateNode(id, { currentItemId: cur.id, itemInfo: itemInfoOf(cur), output, status: output ? 'done' : 'idle' })
  }, [id, getData, updateNode])

  const patchItem = useCallback((itemId: string, patch: Partial<BatchItem>) => {
    updateNode(id, { items: getItems().map((i) => (i.id === itemId ? { ...i, ...patch } : i)) })
  }, [id, getItems, updateNode])

  /** pending / error のアイテムを同時 3 件までアップロードする。 */
  const uploadPending = useCallback(async () => {
    if (uploadingRef.current) { queuedRef.current = true; return }
    uploadingRef.current = true
    setUploading(true)
    updateNode(id, { status: 'generating' })
    try {
      const teamId = await resolveTeamId()
      const store = pendingFiles.get(id)
      const targets = getItems().filter((i) => (i.status === 'pending' || i.status === 'error') && store?.has(i.id))
      setProgress({ done: 0, total: targets.length })
      let done = 0
      await runWithConcurrency(targets, UPLOAD_CONCURRENCY, async (it) => {
        const file = store?.get(it.id)
        if (!file) return
        patchItem(it.id, { status: 'uploading', error: undefined })
        try {
          const size = await readImageSize(file)
          const path = `${interactiveCutoutDir(teamId, id)}/items/${it.id}-${Date.now().toString(36)}-${safeFileName(file.name)}`
          await uploadBatchObject(path, file, file.type || 'image/jpeg')
          patchItem(it.id, { status: 'ready', path, width: size?.width, height: size?.height, error: undefined })
          store?.delete(it.id)
        } catch (e) {
          patchItem(it.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
        }
        done++
        setProgress({ done, total: targets.length })
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'アップロードに失敗しました', 'error')
      updateNode(id, { items: getItems().map((i) => (i.status === 'uploading' ? { ...i, status: 'error', error: 'アップロード失敗' } : i)) })
    } finally {
      uploadingRef.current = false
      setUploading(false)
      setProgress(null)
      await syncCurrent()
      if (queuedRef.current) { queuedRef.current = false; void uploadPending() }
    }
  }, [id, getItems, patchItem, syncCurrent, updateNode])

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    const existing = getItems()
    const room = MAX_BATCH_ITEMS - existing.length
    if (room <= 0) { showToast(`最大 ${MAX_BATCH_ITEMS} 枚までです`, 'warning'); return }
    const accepted = files.slice(0, room)
    if (files.length > room) showToast(`上限 ${MAX_BATCH_ITEMS} 枚を超える ${files.length - room} 枚は追加しませんでした`, 'warning')
    const store = pendingFiles.get(id) ?? new Map<string, File>()
    pendingFiles.set(id, store)
    const newItems: BatchItem[] = accepted.map((f) => {
      const itemId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      store.set(itemId, f)
      return { id: itemId, index: 0, originalName: f.name, sku: extractSku(f.name, params.skuPattern), path: null, size: f.size, status: 'pending' }
    })
    const merged = sortAndIndexItems([...existing, ...newItems])
    const curId = (getData()?.currentItemId as string | null) ?? merged[0]?.id ?? null
    const cur = merged.find((i) => i.id === curId) ?? merged[0]
    updateNode(id, { items: merged, currentItemId: cur?.id ?? null, itemInfo: cur ? itemInfoOf(cur) : undefined })
    void uploadPending()
  }, [id, params.skuPattern, getItems, getData, updateNode, uploadPending])

  // SKU の規則が変わったら全アイテムに適用
  useEffect(() => {
    const list = getItems()
    const next = applySkuPattern(list, params.skuPattern)
    if (next.some((it, i) => it !== list[i])) { updateNode(id, { items: next }); void syncCurrent() }
  }, [params.skuPattern, id, getItems, updateNode, syncCurrent])

  // アップロード中はページ離脱を警告（仕様 4-8）
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
    pendingFiles.get(id)?.delete(itemId)
    updateNode(id, { items: sortAndIndexItems(getItems().filter((i) => i.id !== itemId)) })
    void syncCurrent()
  }, [id, getItems, updateNode, syncCurrent])

  const clearAll = useCallback(() => {
    pendingFiles.delete(id)
    updateNode(id, { items: [], currentItemId: null, itemInfo: undefined, output: undefined, status: 'idle' })
  }, [id, updateNode])

  const makeCurrent = useCallback((itemId: string) => {
    updateNode(id, { currentItemId: itemId })
    void syncCurrent()
  }, [id, updateNode, syncCurrent])

  const patternError = compileSkuPattern(params.skuPattern) === null
  const readyCount = items.filter((i) => i.status === 'ready').length
  const errorCount = items.filter((i) => i.status === 'error').length
  const current = items.find((i) => i.id === currentItemId) ?? items[0]

  return (
    <BaseNode
      {...props}
      data={nodeData}
      icon={<Images size={14} />}
      hideStatus
      outputs={[{ id: 'image', portType: 'image', label: '画像' }, { id: 'item', portType: 'item', label: 'アイテム情報' }]}
    >
      <div className="flex flex-col gap-2.5 nodrag">
        {/* ドロップ / 選択 */}
        <label
          htmlFor={`batch-input-${id}`}
          className="flex flex-col items-center justify-center gap-1 rounded-lg py-3 cursor-pointer transition-colors nodrag"
          style={{ border: dragOver ? `1px dashed ${PP_ACCENT}` : '1px dashed var(--border-active)', background: dragOver ? 'rgba(20,184,166,0.08)' : undefined }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setDragOver(true) } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        >
          <Upload size={18} style={{ color: PP_ACCENT }} />
          <span className="text-[12px]" style={{ color: PP_ACCENT }}>画像をドロップ / クリックして選択</span>
          <span className="text-[11px] text-[var(--text-tertiary)]">最大 {MAX_BATCH_ITEMS} 枚・JPEG / PNG / WebP</span>
        </label>
        <input id={`batch-input-${id}`} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />

        <Field label="SKU の抽出規則（正規表現・最初の一致 / 第 1 グループ）">
          <input
            type="text"
            className={`${CTRL} w-full font-mono`}
            style={{ ...INPUT_STYLE, ...(patternError ? { borderColor: '#EF4444' } : {}) }}
            value={params.skuPattern}
            onKeyDown={stopKeys}
            onChange={(e) => updateNode(id, { params: { ...params, skuPattern: e.target.value } })}
          />
          <div className="text-[11px] mt-1" style={{ color: patternError ? '#EF4444' : 'var(--text-tertiary)' }}>
            {patternError ? '正規表現が不正です（拡張子を除いたファイル名を SKU にします）' : '一致しない場合は拡張子を除いたファイル名を SKU にします。並び順: ファイル名順'}
          </div>
        </Field>

        {/* 状態 */}
        <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
          <span>{items.length} / {MAX_BATCH_ITEMS} 枚・準備完了 {readyCount}{errorCount ? `・失敗 ${errorCount}` : ''}</span>
          {items.length > 0 && (
            <button className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] nodrag" onClick={clearAll}>すべて削除</button>
          )}
        </div>
        {uploading && progress && (
          <div>
            <div className="h-1.5 rounded bg-[var(--bg-elevated)] overflow-hidden">
              <div className="h-full transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: PP_ACCENT }} />
            </div>
            <div className="text-[11px] mt-1" style={{ color: PP_ACCENT }}>アップロード中 {progress.done} / {progress.total}（この間はページを離れないでください）</div>
          </div>
        )}

        {/* 一覧 */}
        {items.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] overflow-auto nodrag nopan" style={{ maxHeight: 240 }} onWheel={(e) => e.stopPropagation()}>
            {items.map((it) => {
              const isCurrent = current?.id === it.id
              return (
                <div key={it.id} className="flex items-center gap-1.5 px-1.5 py-1 border-b border-[var(--border)] last:border-b-0" style={isCurrent ? { background: 'rgba(20,184,166,0.10)' } : undefined}>
                  <div className="w-8 h-8 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                    {it.path && thumbs[it.path] ? <img src={thumbs[it.path]} alt="" className="w-full h-full object-cover" draggable={false} /> : <span className="text-[10px] text-[var(--text-tertiary)]">{it.index}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[var(--text-primary)] truncate" title={it.originalName}>{it.index}. {it.originalName}</div>
                    <div className="text-[10px] text-[var(--text-secondary)] truncate">SKU: {it.sku}{it.width ? `・${it.width}×${it.height}` : ''}{it.error ? `・${it.error}` : ''}</div>
                  </div>
                  <div className="shrink-0 flex items-center gap-0.5">
                    {it.status === 'uploading' && <Loader2 size={12} className="animate-spin" style={{ color: PP_ACCENT }} />}
                    {it.status === 'ready' && <Check size={12} style={{ color: '#22C55E' }} />}
                    {it.status === 'error' && (
                      <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] nodrag" title="再試行" onClick={() => void uploadPending()}>
                        {pendingFiles.get(id)?.has(it.id) ? <RefreshCw size={12} style={{ color: '#EF4444' }} /> : <AlertCircle size={12} style={{ color: '#EF4444' }} />}
                      </button>
                    )}
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] nodrag"
                      title={isCurrent ? '対話実行で流す 1 枚' : 'この画像を先頭にする（対話実行で流す）'}
                      onClick={() => makeCurrent(it.id)}
                    >
                      <Star size={12} fill={isCurrent ? PP_ACCENT : 'none'} style={{ color: isCurrent ? PP_ACCENT : 'var(--text-tertiary)' }} />
                    </button>
                    <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] nodrag" title="削除" onClick={() => removeItem(it.id)}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="text-[11px] text-[var(--text-tertiary)] leading-snug">
          {current
            ? <>対話実行では ★ の 1 枚（{current.index}. {current.sku}）だけを流します。一括実行は Step 5 で追加予定です</>
            : <>対話実行では先頭の 1 枚だけを流します（★ で差し替え可）</>}
        </div>
      </div>
    </BaseNode>
  )
}

export const BatchInputNode = memo(BatchInputNodeInner)
