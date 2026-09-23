import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Scissors, Play, Loader2, Download, RefreshCw } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSignedMedia } from '../../hooks/useSignedMedia'
import { useBatchSignedUrl } from '../../hooks/useBatchSignedUrl'
import { showToast } from '../../hooks/useToast'
import { toCanonicalRef } from '../../lib/api/storage'
import type { NodeData, CutoutParams, CutoutPreviewBg, CutoutRef } from '../../types/nodes'
import { CUTOUT_ENGINES, normalizeCutoutParams } from '../../lib/cutout/engines'
import { CutoutParamsForm } from './pp/CutoutParamsForm'
import { interactiveCutoutDir, resolveFetchableUrl, resolveTeamId, signBatchPath } from '../../lib/cutout/store'
import {
  loadOriginal, loadRawAlpha, reapplyCutoutParams, renderCutoutFullPng, runCutoutInteractive,
} from '../../lib/cutout/runCutout'
import { REMOVE_BACKGROUND_INPUT_HANDLE, imageUrlFromNodeData } from '../../lib/cutout/upstream'
import type { AlphaMap } from '../../lib/cutout/alpha'
import type { DecodedImage } from '../../lib/cutout/decode'

const ACCENT = '#14B8A6'


// プレビュー背景（仕様 3-2: 白 / グレー / 市松）
const PREVIEW_BG: Record<CutoutPreviewBg, CSSProperties> = {
  white: { background: '#FFFFFF' },
  gray: { background: '#808080' },
  checker: {
    backgroundColor: '#FFFFFF',
    backgroundImage:
      'linear-gradient(45deg,#CCCCCC 25%,transparent 25%),linear-gradient(-45deg,#CCCCCC 25%,transparent 25%),' +
      'linear-gradient(45deg,transparent 75%,#CCCCCC 75%),linear-gradient(-45deg,transparent 75%,#CCCCCC 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
  },
}
const PREVIEW_BG_LABEL: Record<CutoutPreviewBg, string> = { white: '白', gray: 'グレー', checker: '市松' }



function Notice({ tone, children }: { tone: 'warning' | 'info'; children: ReactNode }) {
  const color = tone === 'warning' ? '#F59E0B' : 'var(--text-secondary)'
  const bg = tone === 'warning' ? 'rgba(245,158,11,0.12)' : 'var(--bg-elevated)'
  return <div className="rounded-md px-2 py-1 text-[11px]" style={{ color, background: bg }}>{children}</div>
}

interface SessionCache { maskPath: string; rawAlpha: AlphaMap; original: DecodedImage }

function RemoveBackgroundNodeInner(props: NodeProps) {
  const { id, data } = props
  const nodeData = data as unknown as NodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const edges = useCanvasStore((s) => s.edges)
  const nodes = useCanvasStore((s) => s.nodes)
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId)

  const params = useMemo(() => normalizeCutoutParams(nodeData.params), [nodeData.params])
  const output = (nodeData.output ?? undefined) as CutoutRef | undefined
  const status = nodeData.status
  const progress = typeof nodeData.progress === 'string' ? nodeData.progress : ''
  const error = typeof nodeData.error === 'string' ? nodeData.error : null
  const isRunning = status === 'generating'

  // 上流の画像（in-image-image に接続されたノードから取る。blob: は表示にしか使えない）
  const upstreamEdge = edges.find((e) => e.target === id && e.targetHandle === REMOVE_BACKGROUND_INPUT_HANDLE)
  const upstreamNode = upstreamEdge ? nodes.find((n) => n.id === upstreamEdge.source) : undefined
  const rawUpstreamUrl = imageUrlFromNodeData(upstreamNode?.data as Record<string, unknown> | undefined)
  const { freshUrl } = useSignedMedia(rawUpstreamUrl, currentWorkflowId)
  const upstreamCanonical = rawUpstreamUrl ? (toCanonicalRef(rawUpstreamUrl) ?? rawUpstreamUrl) : null

  const isStale = !!output && !!upstreamCanonical && output.sourceRef !== upstreamCanonical
  const paramsDirty = !!output && (
    output.params.alphaThreshold !== params.alphaThreshold || output.params.featherPx !== params.featherPx
  )
  const engineDirty = !!output && (
    output.params.engine !== params.engine ||
    (params.engine === 'birefnet' && (
      output.params.birefnetModel !== params.birefnetModel || output.params.birefnetResolution !== params.birefnetResolution
    ))
  )

  const previewUrl = useBatchSignedUrl(output?.previewPath)
  const cacheRef = useRef<SessionCache | null>(null)
  const [busy, setBusy] = useState<null | 'reapply' | 'download'>(null)

  const setParams = useCallback((patch: Partial<CutoutParams>) => {
    updateNode(id, { params: { ...params, ...patch } })
  }, [id, params, updateNode])

  const handleRun = useCallback(async () => {
    if (!rawUpstreamUrl) {
      showToast('入力に画像を接続してください', 'warning')
      return
    }
    updateNode(id, { status: 'generating', progress: '準備中…', error: null })
    try {
      const teamId = await resolveTeamId()
      if (rawUpstreamUrl.startsWith('blob:') || rawUpstreamUrl.startsWith('data:')) {
        throw new Error('画像のアップロード完了を待ってから実行してください')
      }
      const sourceRef = toCanonicalRef(rawUpstreamUrl) ?? rawUpstreamUrl
      const url = await resolveFetchableUrl({ canonical: sourceRef, fresh: freshUrl, liveUrl: rawUpstreamUrl })
      const res = await runCutoutInteractive({
        dir: interactiveCutoutDir(teamId, id),
        imageUrl: url,
        sourceRef,
        params,
        onProgress: (m) => updateNode(id, { progress: m }),
      })
      cacheRef.current = { maskPath: res.ref.maskPath, rawAlpha: res.rawAlpha, original: res.original }
      updateNode(id, { status: 'done', output: res.ref, progress: '', error: null })
    } catch (e) {
      updateNode(id, { status: 'error', progress: '', error: e instanceof Error ? e.message : String(e) })
    }
  }, [id, params, rawUpstreamUrl, freshUrl, updateNode])

  /** 再適用/ダウンロードに必要な元画像と生マスクをセッション内に用意する（再読込後は保存先から読み戻す）。 */
  const ensureCache = useCallback(async (): Promise<SessionCache> => {
    if (!output) throw new Error('先に実行してください')
    const c = cacheRef.current
    if (c && c.maskPath === output.maskPath) return c
    if (!rawUpstreamUrl || rawUpstreamUrl.startsWith('blob:') || rawUpstreamUrl.startsWith('data:')) {
      throw new Error('元画像を取得できません。入力画像を接続し直してください')
    }
    const url = await resolveFetchableUrl({ canonical: toCanonicalRef(rawUpstreamUrl) ?? rawUpstreamUrl, fresh: freshUrl, liveUrl: rawUpstreamUrl })
    const maskUrl = await signBatchPath(output.maskPath)
    if (!maskUrl) throw new Error('マスクを取得できません（チームの権限を確認してください）')
    const [original, rawAlpha] = await Promise.all([loadOriginal(url), loadRawAlpha(maskUrl, output.width, output.height)])
    if (original.width !== output.width || original.height !== output.height) {
      throw new Error('元画像の寸法が実行時と異なります。再実行してください')
    }
    const next = { maskPath: output.maskPath, rawAlpha, original }
    cacheRef.current = next
    return next
  }, [output, freshUrl, rawUpstreamUrl])

  const handleReapply = useCallback(async () => {
    if (!output) return
    setBusy('reapply')
    try {
      const c = await ensureCache()
      const teamId = await resolveTeamId()
      const ref = await reapplyCutoutParams({
        ref: output, rawAlpha: c.rawAlpha, original: c.original, params, dir: interactiveCutoutDir(teamId, id),
      })
      updateNode(id, { output: ref, status: 'done', error: null })
    } catch (e) {
      showToast(e instanceof Error ? e.message : '再適用に失敗しました', 'error')
    } finally {
      setBusy(null)
    }
  }, [id, output, params, ensureCache, updateNode])

  const handleDownload = useCallback(async () => {
    if (!output) return
    setBusy('download')
    try {
      const c = await ensureCache()
      const blob = await renderCutoutFullPng(c.original, c.rawAlpha, params)
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `cutout-${params.engine}-${Date.now()}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'ダウンロードに失敗しました', 'error')
    } finally {
      setBusy(null)
    }
  }, [output, params, ensureCache])


  return (
    <BaseNode
      {...props}
      data={nodeData}
      icon={<Scissors size={14} />}
      hideStatus
      inputs={[{ id: 'image', portType: 'image', label: '画像' }]}
      outputs={[{ id: 'cutout', portType: 'cutout', label: '切り抜き' }]}
    >
      <div className="flex flex-col gap-2.5 nodrag">
        {/* エンジン */}
        <CutoutParamsForm params={params} onChange={setParams} disabled={isRunning} />

        {/* プレビュー（背景 白/グレー/市松） */}
        <div
          className="relative rounded-lg overflow-hidden border border-[var(--border)]"
          style={{ ...PREVIEW_BG[params.previewBg], aspectRatio: output ? `${output.width} / ${output.height}` : '4 / 3' }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="切り抜きプレビュー" className="w-full h-full object-contain block" draggable={false} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px]" style={{ color: '#6B7280' }}>
              {output ? '読み込み中…' : rawUpstreamUrl ? '「実行」で切り抜きます' : '画像を接続してください'}
            </div>
          )}
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            {(Object.keys(PREVIEW_BG) as CutoutPreviewBg[]).map((bg) => (
              <button
                key={bg}
                title={`背景: ${PREVIEW_BG_LABEL[bg]}`}
                onClick={() => setParams({ previewBg: bg })}
                className="w-5 h-5 rounded nodrag"
                style={{
                  ...PREVIEW_BG[bg],
                  ...(bg === 'checker' ? { backgroundSize: '8px 8px', backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0' } : {}),
                  border: params.previewBg === bg ? `2px solid ${ACCENT}` : '1px solid rgba(0,0,0,0.35)',
                }}
              />
            ))}
          </div>
        </div>

        {output && (
          <div className="text-[11px] text-[var(--text-secondary)] leading-snug">
            {output.width}×{output.height}
            {output.bbox ? `・商品 ${output.bbox.w}×${output.bbox.h} @ (${output.bbox.x}, ${output.bbox.y})` : '・商品を検出できませんでした'}
            ・{CUTOUT_ENGINES[output.engine].label}
          </div>
        )}
        {isStale && <Notice tone="warning">入力画像が変わりました。再実行してください</Notice>}
        {!isStale && engineDirty && <Notice tone="info">エンジン設定が変わりました。「実行」で反映されます</Notice>}

        <button
          className="w-full h-9 rounded-lg flex items-center justify-center gap-1.5 text-[12px] font-medium text-white transition-all duration-150 disabled:opacity-50 nodrag"
          style={{ background: ACCENT }}
          onClick={handleRun}
          disabled={isRunning || !rawUpstreamUrl}
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {isRunning ? '実行中…' : output ? '再実行（fal）' : '実行（fal）'}
        </button>

        {output && (
          <div className="flex gap-1.5">
            <button
              className="flex-1 h-8 rounded-md flex items-center justify-center gap-1 text-[11px] text-[var(--text-primary)] border border-[var(--border-active)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40 nodrag"
              onClick={handleReapply}
              disabled={!paramsDirty || busy !== null || isRunning}
              title="しきい値/ぼかしを保存済みマスクに再適用（fal は呼びません）"
            >
              {busy === 'reapply' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              再適用
            </button>
            <button
              className="flex-1 h-8 rounded-md flex items-center justify-center gap-1 text-[11px] text-[var(--text-primary)] border border-[var(--border-active)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40 nodrag"
              onClick={handleDownload}
              disabled={busy !== null || isRunning}
              title="フル解像度の透過 PNG をダウンロード（評価用）"
            >
              {busy === 'download' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              透過 PNG
            </button>
          </div>
        )}

        {isRunning && progress && <div className="text-[11px]" style={{ color: ACCENT }}>{progress}</div>}
        {status === 'error' && error && <div className="text-[11px] break-words" style={{ color: '#EF4444' }}>{error}</div>}
      </div>
    </BaseNode>
  )
}

export const RemoveBackgroundNode = memo(RemoveBackgroundNodeInner)
