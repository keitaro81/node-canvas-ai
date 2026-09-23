import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { LayoutTemplate, Loader2, RefreshCw } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSignedMedia } from '../../hooks/useSignedMedia'
import { toCanonicalRef } from '../../lib/api/storage'
import type { NodeData, LayoutParams, LayoutOutputRef } from '../../types/nodes'
import { computeLayout, effectiveMargins, normalizeLayoutParams } from '../../lib/layout/computeLayout'
import { PRODUCT_LAYOUT_INPUT_BACKGROUND, PRODUCT_LAYOUT_INPUT_CUTOUT, cutoutRefFromNodeData } from '../../lib/layout/nodeIo'
import { loadLayoutAssets, runLayout, storeLayoutOutput, type LayoutAssets } from '../../lib/layout/runLayout'
import { layoutHash } from '../../lib/layout/identity'
import { interactiveCutoutDir, resolveFetchableUrl, resolveTeamId, signBatchPath } from '../../lib/cutout/store'
import { REMOVE_BACKGROUND_INPUT_HANDLE, imageUrlFromNodeData } from '../../lib/cutout/upstream'
import { LayoutParamsForm } from './pp/LayoutParamsForm'
import { CHECKER } from './pp/styles'

const RENDER_DEBOUNCE_MS = 500

function ProductLayoutNodeInner(props: NodeProps) {
  const { id, data } = props
  const nodeData = data as unknown as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const edges = useCanvasStore((s) => s.edges)
  const nodes = useCanvasStore((s) => s.nodes)
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId)

  const params = useMemo(() => normalizeLayoutParams(nodeData.params), [nodeData.params])
  const layout = (nodeData.layout ?? undefined) as LayoutOutputRef | undefined
  const status = nodeData.status
  const error = typeof nodeData.error === 'string' ? nodeData.error : null

  // 上流: 切り抜き（必須）と背景画像（任意）
  const cutoutEdge = edges.find((e) => e.target === id && e.targetHandle === PRODUCT_LAYOUT_INPUT_CUTOUT)
  const cutoutNode = cutoutEdge ? nodes.find((n) => n.id === cutoutEdge.source) : undefined
  const cutout = cutoutRefFromNodeData(cutoutNode?.data as Record<string, unknown> | undefined)
  const bgEdge = edges.find((e) => e.target === id && e.targetHandle === PRODUCT_LAYOUT_INPUT_BACKGROUND)
  const bgNode = bgEdge ? nodes.find((n) => n.id === bgEdge.source) : undefined
  const bgUrl = params.backgroundKind === 'image' ? imageUrlFromNodeData(bgNode?.data as Record<string, unknown> | undefined) : null
  const bgCanonical = bgUrl ? (toCanonicalRef(bgUrl) ?? bgUrl) : null

  // 元画像は切り抜きの sourceRef（canonical）を署名して取る（ワークフロー認可 → batch チーム署名 → 上流ノードの現在 URL の順）
  const { freshUrl: freshOriginalUrl } = useSignedMedia(cutout?.sourceRef ?? null, currentWorkflowId)
  const imageSourceEdge = cutoutNode ? edges.find((e) => e.target === cutoutNode.id && e.targetHandle === REMOVE_BACKGROUND_INPUT_HANDLE) : undefined
  const imageSourceNode = imageSourceEdge ? nodes.find((n) => n.id === imageSourceEdge.source) : undefined
  const liveOriginalUrl = imageUrlFromNodeData(imageSourceNode?.data as Record<string, unknown> | undefined)
  const outputUrl = typeof nodeData.output === 'string' ? nodeData.output : null
  const { url: signedOutput, onError: onOutputError } = useSignedMedia(outputUrl, currentWorkflowId)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'render' | 'upload'>(null)
  const assetsRef = useRef<{ key: string; assets: LayoutAssets } | null>(null)
  const runIdRef = useRef(0)
  const previewRef = useRef<string | null>(null)

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])
  const setPreview = useCallback((blob: Blob) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const u = URL.createObjectURL(blob)
    previewRef.current = u
    setPreviewUrl(u)
  }, [])

  const setParams = useCallback((patch: Partial<LayoutParams>) => {
    updateNode(id, { params: { ...params, ...patch } })
  }, [id, params, updateNode])

  const cutoutKey = cutout
    ? `${cutout.sourceRef}|${cutout.maskPath}|${JSON.stringify(cutout.bbox)}|${cutout.params.alphaThreshold}|${cutout.params.featherPx}`
    : ''
  const paramsKey = JSON.stringify(params)

  /** 計算 → 描画 → プレビュー → 保存（同じ識別値なら保存を省略）。 */
  const render = useCallback(async () => {
    if (!cutout) return
    const runId = ++runIdRef.current
    // 識別値が保存済みの出力と同じなら描き直さない（再読込時など。仕様 4-10）
    const stored = (useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as NodeData | undefined)
    const storedLayout = stored?.layout as LayoutOutputRef | undefined
    const hash = await layoutHash({
      params, sourceRef: cutout.sourceRef, maskPath: cutout.maskPath,
      alphaThreshold: cutout.params.alphaThreshold, featherPx: cutout.params.featherPx, backgroundRef: bgCanonical,
    })
    if (runId !== runIdRef.current) return
    if (storedLayout?.layoutHash === hash && storedLayout.path && typeof stored?.output === 'string' && stored.output) {
      if (stored.status !== 'done') updateNode(id, { status: 'done', error: null })
      return
    }
    setBusy('render')
    updateNode(id, { status: 'generating', error: null })
    try {
      const originalUrl = await resolveFetchableUrl({ canonical: cutout.sourceRef, fresh: freshOriginalUrl, liveUrl: liveOriginalUrl })
      const key = `${cutout.sourceRef}|${cutout.maskPath}|${bgUrl ?? ''}`
      let assets = assetsRef.current?.key === key ? assetsRef.current.assets : null
      if (!assets) {
        assets = await loadLayoutAssets({ originalUrl, cutout, backgroundUrl: bgUrl })
        assetsRef.current = { key, assets }
      }
      if (runId !== runIdRef.current) return
      const result = await runLayout({ params, cutout, assets, backgroundRef: bgCanonical })
      if (runId !== runIdRef.current) return
      setPreview(result.blob)

      const current = (useCanvasStore.getState().nodes.find((n) => n.id === id)?.data as NodeData | undefined)?.layout as LayoutOutputRef | undefined
      if (current?.layoutHash === result.hash && current.path) {
        updateNode(id, { status: 'done', error: null })
        return
      }
      setBusy('upload')
      const teamId = await resolveTeamId()
      const ref = await storeLayoutOutput({ dir: interactiveCutoutDir(teamId, id), result, cutout })
      const signed = await signBatchPath(ref.path)
      if (runId !== runIdRef.current) return
      updateNode(id, { output: signed ?? undefined, layout: ref, status: 'done', error: null })
    } catch (e) {
      if (runId === runIdRef.current) updateNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
    } finally {
      if (runId === runIdRef.current) setBusy(null)
    }
  }, [id, cutout, params, bgUrl, bgCanonical, freshOriginalUrl, liveOriginalUrl, setPreview, updateNode])

  // パラメータ/入力が変わったら自動で描き直す（ローカル計算のみ・fal は使わない）
  const renderRef = useRef(render)
  renderRef.current = render
  useEffect(() => {
    if (!cutoutKey) return
    const t = setTimeout(() => { void renderRef.current() }, RENDER_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [cutoutKey, paramsKey, bgUrl])

  // 実効余白（拡大の上限で止まると設定値より広くなる）。背景は余白に影響しないので null でよい
  const livePlan = useMemo(() => (cutout
    ? computeLayout({ params, source: { width: cutout.width, height: cutout.height }, bbox: cutout.bbox, background: null })
    : null), [cutout, params])
  const eff = livePlan ? effectiveMargins(livePlan) : null
  const setPct = (v: number, base: number) => (params.marginUnit === 'percent' ? v : Math.round((v / base) * 1000) / 10)
  // 上限で止まっている（設定より広い余白の原因）か、縦横比の違いで一方の辺だけ余っているか
  const scaleCapped = !!livePlan && livePlan.scale < livePlan.fitScale - 1e-6
  const marginDeviates = !!eff && (
    Math.abs(eff.topPct - setPct(params.marginTop, params.height)) > 1 || Math.abs(eff.leftPct - setPct(params.marginLeft, params.width)) > 1
  )
  const warnings = layout?.warnings ?? []
  const isTransparent = params.backgroundKind === 'transparent'
  const shownUrl = previewUrl ?? signedOutput ?? null

  return (
    <BaseNode
      {...props}
      data={nodeData}
      icon={<LayoutTemplate size={14} />}
      hideStatus
      inputs={[{ id: 'cutout', portType: 'cutout', label: '切り抜き' }, { id: 'background', portType: 'image', label: '背景画像' }]}
      outputs={[{ id: 'image', portType: 'image', label: '画像' }]}
    >
      <div className="flex flex-col gap-2.5 nodrag">
        <LayoutParamsForm
          params={params}
          onChange={setParams}
          marginNote={eff && livePlan ? {
            text: `実効: 上 ${eff.topPct}% 右 ${eff.rightPct}% 下 ${eff.bottomPct}% 左 ${eff.leftPct}%・倍率 ${Math.round(livePlan.scale * 100)}%${scaleCapped ? '（拡大の上限で止まっています）' : marginDeviates ? '（縦横比の違いで一方の辺が余ります）' : ''}`,
            warn: scaleCapped,
          } : null}
        />

        {/* プレビュー */}
        <div
          className="relative rounded-lg overflow-hidden border border-[var(--border)]"
          style={{ ...(isTransparent ? CHECKER : { background: '#8A8A8A' }), aspectRatio: `${params.width} / ${params.height}`, maxHeight: 360 }}
        >
          {shownUrl ? (
            <img src={shownUrl} alt="レイアウト結果" className="w-full h-full object-contain block" draggable={false} onError={previewUrl ? undefined : onOutputError} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px]" style={{ color: '#F5F5F5' }}>
              {cutout ? '描画中…' : '切り抜きを接続してください'}
            </div>
          )}
          {busy && (
            <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <Loader2 size={10} className="animate-spin" />{busy === 'render' ? '描画中' : '保存中'}
            </div>
          )}
        </div>

        <div className="text-[11px] text-[var(--text-secondary)] leading-snug">
          {params.width}×{params.height}・{params.variantName}
          {layout && ` ・保存済み`}
        </div>
        {warnings.map((w) => (
          <div key={w} className="rounded-md px-2 py-1 text-[11px]" style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.12)' }}>{w}</div>
        ))}
        {status === 'error' && error && (
          <div className="flex items-start gap-1.5">
            <div className="flex-1 text-[11px] break-words" style={{ color: '#EF4444' }}>{error}</div>
            <button className="h-7 px-2 rounded-md text-[11px] border border-[var(--border-active)] hover:bg-[var(--bg-elevated)] nodrag" onClick={() => void render()} title="再描画">
              <RefreshCw size={12} />
            </button>
          </div>
        )}
        {!cutout && <div className="text-[11px] text-[var(--text-tertiary)]">Remove Background の出力を「切り抜き」に接続すると自動で描画します</div>}
      </div>
    </BaseNode>
  )
}

export const ProductLayoutNode = memo(ProductLayoutNodeInner)
