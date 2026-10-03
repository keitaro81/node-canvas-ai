import { memo, useCallback, useMemo, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Download, Loader2 } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { signMediaRequest, toCanonicalRef } from '../../lib/api/storage'
import type { NodeData, BatchItemInfo, CutoutRef, ExportFileResult, ExportFormat, ExportParams, ExportResult, ExportZipFolders } from '../../types/nodes'
import { EXT_OF, normalizeExportParams, planExportEntries, zipFileName } from '../../lib/export/naming'
import { bitmapHasTransparency, encodeWithCap, loadBitmap } from '../../lib/export/encode'
import { buildZip, downloadBlob } from '../../lib/export/zip'
import { renderCutoutPngForExport } from '../../lib/export/cutoutFile'
import { normalizeLayoutParams } from '../../lib/layout/computeLayout'
import { PRODUCT_LAYOUT_INPUT_CUTOUT, cutoutRefFromNodeData } from '../../lib/layout/nodeIo'
import { resolveFetchableUrl } from '../../lib/cutout/store'
import { REMOVE_BACKGROUND_INPUT_HANDLE, imageUrlFromNodeData } from '../../lib/cutout/upstream'
import { Field, Num, Sel, TextField } from './pp/controls'
import { PP_ACCENT } from './pp/styles'

export const EXPORT_MAX_IMAGE_SLOTS = 10
export const EXPORT_ITEM_HANDLE = 'in-item-item'

interface SlotInput {
  slot: number
  kind: 'image' | 'cutout'           // cutout = 切り抜きの透過 PNG（Product Layout につながる Remove Background から）
  url: string | null
  variant: string
  transparent: boolean | null
  forcePng?: boolean
  sourceLabel: string
  cutout?: CutoutRef | null          // kind cutout: Remove Background の出力（未実行なら null）
  liveOriginalUrl?: string | null    // kind cutout: 元画像ノードが今持っている URL（署名の取り直しに使う）
}

/** 上流ノードの種類に応じて、書き出しに必要な情報（URL・バリアント名・透過か）を取り出す。 */
function describeSource(node: AppNode | undefined, slot: number): SlotInput {
  const d = node?.data as NodeData | undefined
  if (!d) return { slot, kind: 'image', url: null, variant: 'image', transparent: null, sourceLabel: '' }
  if (d.type === 'productLayout') {
    const p = normalizeLayoutParams(d.params)
    return { slot, kind: 'image', url: imageUrlFromNodeData(d as Record<string, unknown>), variant: p.variantName, transparent: p.backgroundKind === 'transparent', sourceLabel: d.label }
  }
  const label = (typeof d.label === 'string' && d.label.trim()) ? d.label.trim() : 'image'
  return { slot, kind: 'image', url: imageUrlFromNodeData(d as Record<string, unknown>), variant: label, transparent: null, sourceLabel: d.label }
}

/** 画像入力の上流をたどって BatchInput のアイテム情報を探す（アイテム情報が未接続のときの補助）。 */
function findUpstreamItemInfo(startIds: string[], nodes: AppNode[], edges: { source: string; target: string }[]): BatchItemInfo | null {
  const seen = new Set<string>()
  let frontier = [...startIds]
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const next: string[] = []
    for (const nid of frontier) {
      if (seen.has(nid)) continue
      seen.add(nid)
      const n = nodes.find((x) => x.id === nid)
      const d = n?.data as NodeData | undefined
      if (d?.type === 'batchInput' && d.itemInfo && typeof d.itemInfo === 'object') return d.itemInfo as BatchItemInfo
      for (const e of edges) if (e.target === nid) next.push(e.source)
    }
    frontier = next
  }
  return null
}

const DEFAULT_ITEM: BatchItemInfo = { sku: 'item', original: 'image', index: 1 }

async function fetchImage(url: string, workflowId: string | null): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' }).catch(() => null)
  if (res?.ok) return res.blob()
  // 署名切れ等: ワークフロー認可 → batch チーム署名 の順で取り直す
  const canonical = toCanonicalRef(url) ?? url
  const fresh = await resolveFetchableUrl({
    canonical,
    fresh: async () => (workflowId ? (await signMediaRequest({ workflowId }))[canonical] : null),
  })
  if (fresh === canonical) throw new Error(`画像を取得できません（${res?.status ?? 'network'}）`)
  const r2 = await fetch(fresh, { mode: 'cors', credentials: 'omit' })
  if (!r2.ok) throw new Error(`画像を取得できません（${r2.status}）`)
  return r2.blob()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function ExportNodeInner(props: NodeProps) {
  const { id, data } = props
  const nodeData = data as unknown as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const edges = useCanvasStore((s) => s.edges)
  const nodes = useCanvasStore((s) => s.nodes)
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId)

  const params = useMemo(() => normalizeExportParams(nodeData.params), [nodeData.params])
  const lastExport = (nodeData.lastExport ?? undefined) as ExportResult | undefined
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  // 画像スロット（接続数 + 1 個の空きスロット。最大 10）
  const slotEdges = edges.filter((e) => e.target === id && e.targetHandle?.startsWith('in-image-'))
  const connectedSlots = slotEdges.map((e) => Number(e.targetHandle!.slice('in-image-'.length))).filter((n) => Number.isInteger(n))
  const slotCount = Math.min(EXPORT_MAX_IMAGE_SLOTS, Math.max(1, (connectedSlots.length ? Math.max(...connectedSlots) + 1 : 0) + 1))
  const inputs: SlotInput[] = useMemo(() => slotEdges
    .map((e) => ({ slot: Number(e.targetHandle!.slice('in-image-'.length)), node: nodes.find((n) => n.id === e.source) }))
    .sort((a, b) => a.slot - b.slot)
    .map(({ slot, node }) => describeSource(node, slot)), [slotEdges, nodes])

  // アイテム情報: 接続があればそれ、無ければ上流をたどる
  const itemEdge = edges.find((e) => e.target === id && e.targetHandle === EXPORT_ITEM_HANDLE)
  const itemNode = itemEdge ? nodes.find((n) => n.id === itemEdge.source) : undefined
  const connectedInfo = (itemNode?.data as NodeData | undefined)?.itemInfo as BatchItemInfo | undefined
  const upstreamInfo = useMemo(() => (connectedInfo ? null : findUpstreamItemInfo(slotEdges.map((e) => e.source), nodes, edges)), [connectedInfo, slotEdges, nodes, edges])
  const itemInfo: BatchItemInfo = connectedInfo ?? upstreamInfo ?? DEFAULT_ITEM
  const itemSource = connectedInfo ? 'connected' : upstreamInfo ? 'upstream' : 'none'

  // 切り抜きの透過 PNG: 接続中の Product Layout が受けている Remove Background ごとに 1 件（先頭に並べる）
  const cutoutInputs: SlotInput[] = useMemo(() => {
    if (!params.includeCutout) return []
    const seen = new Set<string>()
    const out: SlotInput[] = []
    for (const e of slotEdges) {
      const layout = nodes.find((n) => n.id === e.source)
      if ((layout?.data as NodeData | undefined)?.type !== 'productLayout') continue
      const ce = edges.find((x) => x.target === layout!.id && x.targetHandle === PRODUCT_LAYOUT_INPUT_CUTOUT)
      const rb = ce ? nodes.find((n) => n.id === ce.source) : undefined
      if (!rb || seen.has(rb.id)) continue
      seen.add(rb.id)
      const ie = edges.find((x) => x.target === rb.id && x.targetHandle === REMOVE_BACKGROUND_INPUT_HANDLE)
      out.push({
        slot: -1 - out.length, kind: 'cutout', url: null, variant: 'cutout', transparent: true, forcePng: true,
        sourceLabel: (rb.data as NodeData).label,
        cutout: cutoutRefFromNodeData(rb.data as Record<string, unknown>),
        liveOriginalUrl: imageUrlFromNodeData(nodes.find((n) => n.id === ie?.source)?.data as Record<string, unknown> | undefined),
      })
    }
    return out
  }, [params.includeCutout, slotEdges, nodes, edges])
  const allInputs = useMemo(() => [...cutoutInputs, ...inputs], [cutoutInputs, inputs])

  const now = useMemo(() => new Date(), [])
  const toPlanned = (list: SlotInput[]) => list.map((i) => ({ variant: i.variant, transparent: !!i.transparent, forcePng: i.forcePng }))
  const plan = useMemo(() => planExportEntries(toPlanned(allInputs), params, itemInfo, now), [allInputs, params, itemInfo, now])

  const setParams = useCallback((patch: Partial<ExportParams>) => updateNode(id, { params: { ...params, ...patch } }), [id, params, updateNode])

  const handleExport = useCallback(async () => {
    if (!inputs.length || busy) return
    setBusy(true)
    updateNode(id, { status: 'generating', error: null })
    const startedAt = new Date()
    try {
      const planNow = planExportEntries(toPlanned(allInputs), params, itemInfo, startedAt)
      const files: ExportFileResult[] = []
      const zipFiles: Array<{ path: string; data: Uint8Array }> = []
      const warnings = [...planNow.warnings]
      const maxBytes = params.maxFileKb ? params.maxFileKb * 1024 : null
      for (let i = 0; i < allInputs.length; i++) {
        const inp = allInputs[i]
        const entry = planNow.entries[i]
        if (inp.kind === 'cutout') {
          // 切り抜きの透過 PNG: マスクと元画像からフル解像度で描く（Remove Background の「透過 PNG」と同じ）
          if (!inp.cutout) { warnings.push(`切り抜き（${inp.sourceLabel}）が未実行のため透過 PNG は書き出せません`); continue }
          setProgress(`${i + 1} / ${allInputs.length}: 切り抜きを描画中…`)
          const png = await renderCutoutPngForExport({ ref: inp.cutout, workflowId: currentWorkflowId, liveUrl: inp.liveOriginalUrl })
          const path = `${entry.folder}${entry.base}.png`
          const w = maxBytes && png.size > maxBytes ? [`PNG は品質調整ができないため上限 ${Math.round(maxBytes / 1024)}KB を超えています（${Math.round(png.size / 1024)}KB）`] : []
          files.push({ path, bytes: png.size, format: 'png', quality: null, warnings: w })
          if (params.zip) zipFiles.push({ path, data: new Uint8Array(await png.arrayBuffer()) })
          else { downloadBlob(png, path); await sleep(400) }
          continue
        }
        if (!inp.url) { warnings.push(`入力 ${inp.slot + 1}（${inp.variant}）に画像がありません`); continue }
        setProgress(`${i + 1} / ${allInputs.length}: 取得中…`)
        const blob = await fetchImage(inp.url, currentWorkflowId)
        const bmp = await loadBitmap(blob)
        let format: ExportFormat = entry.format
        const w = [...entry.warnings]
        if (inp.transparent === null && format === 'jpeg' && bitmapHasTransparency(bmp)) {
          format = 'png'
          w.push(`「${inp.variant}」は透過画素があるため PNG で書き出します`)
        }
        setProgress(`${i + 1} / ${allInputs.length}: 変換中…`)
        const enc = await encodeWithCap(bmp, format, params.jpegQuality, maxBytes)
        bmp.close()
        const path = `${entry.folder}${entry.base}.${EXT_OF[format]}`
        files.push({ path, bytes: enc.blob.size, format, quality: enc.quality, warnings: [...w, ...enc.warnings] })
        if (params.zip) zipFiles.push({ path, data: new Uint8Array(await enc.blob.arrayBuffer()) })
        else { downloadBlob(enc.blob, path); await sleep(400) }
      }
      let zipName: string | null = null
      if (params.zip && zipFiles.length) {
        setProgress('ZIP を作成中…')
        zipName = zipFileName(itemInfo, startedAt)
        downloadBlob(buildZip(zipFiles), zipName)
      }
      const result: ExportResult = { at: startedAt.toISOString(), zipName, files, warnings }
      updateNode(id, { lastExport: result, status: 'done', error: null })
    } catch (e) {
      updateNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
      setProgress('')
    }
  }, [id, inputs, allInputs, busy, params, itemInfo, currentWorkflowId, updateNode])

  const error = typeof nodeData.error === 'string' ? nodeData.error : null
  const showQuality = params.format !== 'png'

  return (
    <BaseNode
      {...props}
      data={nodeData}
      icon={<Download size={14} />}
      hideStatus
      inputs={[
        ...Array.from({ length: slotCount }, (_, i) => ({ id: String(i), portType: 'image' as const, label: `画像 ${i + 1}` })),
        { id: 'item', portType: 'item' as const, label: 'アイテム情報' },
      ]}
    >
      <div className="flex flex-col gap-2.5 nodrag">
        <Field label="ファイル名の規則">
          <TextField value={params.namePattern} onChange={(v) => setParams({ namePattern: v })} mono placeholder="{sku}_{variant}_{index:02}" />
          <div className="text-[11px] mt-1 text-[var(--text-tertiary)]">{'{sku} {original} {variant} {index} {index:02} {date}'}</div>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="形式">
            <Sel<ExportFormat> value={params.format} options={[['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']]} onChange={(v) => setParams({ format: v })} />
          </Field>
          <Field label={showQuality ? '品質（70〜100）' : '品質'}>
            <Num value={params.jpegQuality} min={70} max={100} onChange={(v) => setParams({ jpegQuality: v ?? 90 })} />
          </Field>
          <Field label="最大ファイルサイズ KB">
            <Num value={params.maxFileKb} min={10} max={100000} placeholder="指定なし" onChange={(v) => setParams({ maxFileKb: v })} />
          </Field>
          <Field label="ZIP">
            <div className="flex items-center gap-2 h-8">
              <input type="checkbox" className="nodrag" checked={params.zip} onChange={(e) => setParams({ zip: e.target.checked })} />
              <span className="text-[12px] text-[var(--text-primary)]">ZIP にまとめる</span>
            </div>
          </Field>
          {params.zip && (
            <Field label="ZIP 内のフォルダ分け" className="col-span-2">
              <Sel<ExportZipFolders> value={params.zipFolders} options={[['variant', 'バリアント別'], ['sku', 'SKU 別'], ['none', 'なし']]} onChange={(v) => setParams({ zipFolders: v })} />
            </Field>
          )}
          <Field label="切り抜き" className="col-span-2">
            <div className="flex items-center gap-2 h-8">
              <input type="checkbox" className="nodrag" checked={params.includeCutout} onChange={(e) => setParams({ includeCutout: e.target.checked })} />
              <span className="text-[12px] text-[var(--text-primary)]">切り抜きの透過 PNG も書き出す（cutout/・元のサイズ）</span>
            </div>
          </Field>
        </div>

        {/* ファイル名のプレビュー */}
        <Field label={`書き出すファイル（${allInputs.length} 件）`}>
          <div className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-[11px] font-mono leading-relaxed" style={{ background: 'var(--bg-canvas)' }}>
            {inputs.length === 0 && <div className="text-[var(--text-tertiary)] font-sans">Product Layout の出力を「画像」に接続してください</div>}
            {plan.entries.map((e, i) => (
              <div key={i} className="truncate text-[var(--text-primary)]" title={`${e.folder}${e.base}.${e.ext}`}>{e.folder}{e.base}.{e.ext}</div>
            ))}
          </div>
          <div className="text-[11px] mt-1 text-[var(--text-tertiary)]">
            アイテム: {itemInfo.sku}（#{itemInfo.index}）{itemSource === 'connected' ? '' : itemSource === 'upstream' ? '・上流の Batch Input から取得' : '・アイテム情報が未接続のため既定値'}
          </div>
        </Field>
        {plan.warnings.map((w) => (
          <div key={w} className="rounded-md px-2 py-1 text-[11px]" style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.12)' }}>{w}</div>
        ))}

        <button
          className="w-full h-9 rounded-lg flex items-center justify-center gap-1.5 text-[12px] font-medium text-white transition-all duration-150 disabled:opacity-50 nodrag"
          style={{ background: PP_ACCENT }}
          onClick={() => void handleExport()}
          disabled={busy || inputs.length === 0}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {busy ? (progress || '書き出し中…') : params.zip ? 'ZIP で書き出す' : '書き出す'}
        </button>

        {lastExport && !busy && (
          <div className="text-[11px] text-[var(--text-secondary)] leading-snug">
            <div>前回: {new Date(lastExport.at).toLocaleString()}{lastExport.zipName ? `・${lastExport.zipName}` : ''}</div>
            {lastExport.files.map((f) => (
              <div key={f.path} className="truncate" title={f.path}>{f.path}・{Math.round(f.bytes / 1024)}KB{f.quality !== null ? `・q${f.quality}` : ''}{f.warnings.length ? ' ⚠' : ''}</div>
            ))}
            {lastExport.files.flatMap((f) => f.warnings).concat(lastExport.warnings.filter((w) => !plan.warnings.includes(w))).map((w) => (
              <div key={w} style={{ color: '#F59E0B' }}>{w}</div>
            ))}
          </div>
        )}
        {nodeData.status === 'error' && error && <div className="text-[11px] break-words" style={{ color: '#EF4444' }}>{error}</div>}
      </div>
    </BaseNode>
  )
}

export const ExportNode = memo(ExportNodeInner)
