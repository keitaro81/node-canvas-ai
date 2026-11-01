import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pickedToFiles } from '../../lib/api/library'
import { MediaPickerDialog } from '../library/MediaPickerDialog'
import type { NodeProps } from '@xyflow/react'
import { Images, Upload, X, Loader2, AlertCircle } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { useCanvasStore } from '../../stores/canvasStore'
import { showToast } from '../../hooks/useToast'
import type { NodeData, BatchItem } from '../../types/nodes'
import {
  applySkuPattern, compileSkuPattern, extractSku, itemInfoOf, normalizeBatchInputParams, safeFileName,
} from '../../lib/batch/items'
import { readImageSize, runWithConcurrency } from '../../lib/batch/upload'
import { interactiveCutoutDir, resolveTeamId, signBatchPath, signBatchPaths, uploadBatchObject } from '../../lib/cutout/store'
import { Field, TextField } from './pp/controls'
import { PP_ACCENT } from './pp/styles'

// アップロード用の File はセッション内だけ保持する（canvas_data には保存しない）
const pendingFiles = new Map<string, Map<string, File>>()
const UPLOAD_CONCURRENCY = 3

function BatchInputNodeInner(props: NodeProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
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

  // 試し用の 1 枚（2026-11-02 段階 2）: 入れ直すと置き換え。まとめて処理する写真は App モードで入れる
  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    const file = files[0]
    if (!file) return
    if (files.length > 1) showToast('Batch Input は試し用の 1 枚だけを持ちます（先頭の 1 枚を使います）。まとめて処理する写真は App モードで入れてください', 'info')
    const store = new Map<string, File>()
    pendingFiles.set(id, store)
    const itemId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    store.set(itemId, file)
    const item: BatchItem = { id: itemId, index: 1, originalName: file.name, sku: extractSku(file.name, params.skuPattern), path: null, size: file.size, status: 'pending' }
    updateNode(id, { items: [item], currentItemId: itemId, itemInfo: itemInfoOf(item), output: undefined })
    void uploadPending()
  }, [id, params.skuPattern, updateNode, uploadPending])

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

  const clearAll = useCallback(() => {
    pendingFiles.delete(id)
    updateNode(id, { items: [], currentItemId: null, itemInfo: undefined, output: undefined, status: 'idle' })
  }, [id, updateNode])

  const patternError = compileSkuPattern(params.skuPattern) === null
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
        <button
          type="button"
          className="w-full flex flex-col items-center justify-center gap-1 rounded-lg py-3 cursor-pointer transition-colors nodrag"
          style={{ border: dragOver ? `1px dashed ${PP_ACCENT}` : '1px dashed var(--border-active)', background: dragOver ? 'rgba(20,184,166,0.08)' : undefined }}
          onClick={() => setPickerOpen(true)}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setDragOver(true) } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
          title="クリックで追加（アップロード / ライブラリから選ぶ）。ここにドロップもできます"
        >
          <Upload size={18} style={{ color: PP_ACCENT }} />
          <span className="text-[12px]" style={{ color: PP_ACCENT }}>{current ? '試し用の写真を差し替える' : '試し用の写真をドロップ / クリックして追加'}</span>
          <span className="text-[11px] text-[var(--text-tertiary)]">1 枚・アップロードかライブラリから</span>
        </button>
        <MediaPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} media="image" source="batch-input" onPick={(picked) => { void pickedToFiles(picked).then(handleFiles).catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error')) }} />

        <Field label="SKU の抽出規則（正規表現・最初の一致 / 第 1 グループ）">
          <div style={patternError ? { outline: '1px solid #EF4444', borderRadius: 6 } : undefined}>
            <TextField value={params.skuPattern} onChange={(v) => updateNode(id, { params: { ...params, skuPattern: v } })} mono placeholder="^([A-Za-z0-9-]+)_" />
          </div>
          <div className="text-[11px] mt-1" style={{ color: patternError ? '#EF4444' : 'var(--text-tertiary)' }}>
            {patternError ? '正規表現が不正です（拡張子を除いたファイル名を SKU にします）' : '一致しない場合は拡張子を除いたファイル名を SKU にします。並び順: ファイル名順'}
          </div>
        </Field>

        {uploading && progress && (
          <div className="text-[11px]" style={{ color: PP_ACCENT }}>アップロード中…</div>
        )}
        {/* 試し用の 1 枚（★）: 各ノードの「実行」（対話実行）で下流に流す写真。まとめて処理する写真は App モードで入れる（2026-11-02） */}
        {current && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5">
            <div className="w-12 h-12 rounded shrink-0 overflow-hidden flex items-center justify-center" style={{ background: 'var(--bg-placeholder)' }}>
              {current.path && thumbs[current.path] ? <img src={thumbs[current.path]} alt="" className="w-full h-full object-cover" draggable={false} /> : <Images size={14} className="text-[var(--text-tertiary)]" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-[var(--text-primary)] truncate" title={current.originalName}>★ 試し用: {current.originalName}</div>
              <div className="text-[10px] text-[var(--text-secondary)] truncate">SKU: {current.sku}{current.width ? `・${current.width}×${current.height}` : ''}</div>
            </div>
            {current.status === 'uploading' || current.status === 'pending' ? <Loader2 size={12} className="animate-spin shrink-0" style={{ color: PP_ACCENT }} /> : current.status === 'error' ? <span title={current.error ?? 'アップロード失敗'}><AlertCircle size={12} className="shrink-0" style={{ color: '#EF4444' }} /></span> : null}
            <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] nodrag shrink-0" title="試し用の写真を外す" onClick={clearAll}><X size={12} /></button>
          </div>
        )}
        {items.length > 1 && <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>以前ここに入れた写真 {items.length} 枚は、App モードの「写真を追加」に一度だけ引き継がれます（ノードでは ★ の 1 枚だけを使います）</div>}
        <button className="h-8 w-full rounded-lg text-[12px] font-medium nodrag transition-colors hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }} onClick={() => useCanvasStore.getState().setAppMode('capsule')} title="App モードに切り替えて、まとめて処理する写真を入れます">
          App で写真をまとめて処理する →
        </button>
        <div className="text-[11px] text-[var(--text-tertiary)] leading-snug">ここの写真は試し用の 1 枚です（各ノードの「実行」で流れます）。全部の写真をまとめて処理するときは App モードで写真を入れて「処理する」を押します。</div>
      </div>
    </BaseNode>
  )
}

export const BatchInputNode = memo(BatchInputNodeInner)
