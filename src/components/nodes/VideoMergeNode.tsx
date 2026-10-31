// Video Merge ノード（2026-10-31・設計 docs/specs/product-video-nodes.md §4.3）: 順序付きの動画入力（in-video-1 … in-video-8）を 1 本に結合する。
// 対話実行: 「結合」でつないだ動画（Video Result / Reference Video / 他の Video Merge）をスロット順に fal の ffmpeg merge-videos へ渡し、
// Video Generation と同じく結果用の Video Result ノードを右に作って接続し、そこに動画を出す（1 本だけならそのまま通す。fal は呼ばない）。
// 一括実行では SKU ごとの結合タスクになる（計画は src/lib/batch/plan.ts・サーバーは完了したショットの結果を順に結合）
import { memo, useCallback, useMemo, useState } from 'react'
import { Handle, Position, useEdges, useNodes, type Edge, type NodeProps } from '@xyflow/react'
import { AlertCircle, Film, Loader2, Play, X } from 'lucide-react'
import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { fal } from '../../lib/ai/fal-client'
import { MERGE_VIDEOS_ENDPOINT } from '../../lib/video/productVideo'
import { VIDEO_MERGE_MAX_INPUTS, videoMergeSlotHandle, videoMergeSlotOf } from '../../lib/batch/plan'
import { signMediaRequest, signOwnUpload, toCanonicalRef, uploadVideoFromUrl } from '../../lib/api/storage'
import { saveGeneration, updateGeneration } from '../../lib/api/generations'
import { patchWorkflowNodeOutput } from '../../lib/api/workflows'
import { showToast } from '../../hooks/useToast'
import type { VideoDisplayNodeData, VideoMergeNodeData } from '../../types/nodes'

const ACCENT = '#EC4899'
const HANDLE_STYLE = (color: string) => ({ width: 20, height: 20, background: `radial-gradient(circle, ${color} 3px, var(--bg-surface) 3px 5px, transparent 5px)`, border: 'none', borderRadius: 0 })
const NODE_WIDTH = 280, H_GAP = 40, V_GAP = 10, DISPLAY_HEIGHT = 400

const videoUrlOf = (d: Record<string, unknown> | undefined): string | null => (typeof d?.videoUrl === 'string' && d.videoUrl ? d.videoUrl : null)

/** fal が取りに行ける URL にする（非公開バケットの canonical は署名。署名済み・外部 URL はそのまま） */
async function fetchableUrl(url: string, workflowId: string | null): Promise<string> {
  const canonical = toCanonicalRef(url)
  if (!canonical || canonical !== url) return url
  const map = await signMediaRequest({ workflowId, urls: [canonical], ownUrls: [canonical] })
  return map[canonical] ?? url
}

/** 結果用の Video Result ノードを右に作って out-video に接続する（Video Generation と同じ配置: 既存の結果ノードの下に積む） */
function createResultNode(mergeId: string, progress: string): string | null {
  const { nodes: allNodes, edges: allEdges, addNode, setEdges } = useCanvasStore.getState()
  const thisNode = allNodes.find((n) => n.id === mergeId)
  if (!thisNode) return null
  const existing = allEdges
    .filter((e) => e.source === mergeId && e.sourceHandle === 'out-video')
    .map((e) => allNodes.find((n) => n.id === e.target))
    .filter((n): n is AppNode => n?.type === 'videoDisplayNode')
  const startY = existing.length > 0 ? Math.max(...existing.map((n) => n.position.y)) + DISPLAY_HEIGHT + V_GAP : thisNode.position.y
  const displayId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  addNode({
    id: displayId,
    type: 'videoDisplayNode',
    position: { x: thisNode.position.x + NODE_WIDTH + H_GAP, y: startY },
    data: { label: 'Video Result', videoUrl: null, fileName: null, autoPlay: false, loop: true, muted: false, status: 'queued', progress, error: null } as unknown as VideoDisplayNodeData,
    ...(thisNode.parentId ? { parentId: thisNode.parentId } : {}),
  } as unknown as AppNode)
  const { edges: latest } = useCanvasStore.getState()
  setEdges([...latest, { id: `e-merge-${mergeId}-disp-${displayId}`, source: mergeId, sourceHandle: 'out-video', target: displayId, targetHandle: 'in-video', style: { stroke: ACCENT, strokeWidth: 2 }, animated: false, className: '' } as Edge])
  return displayId
}

function VideoMergeNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as VideoMergeNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const rfNodes = useNodes()
  const rfEdges = useEdges()
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const [busy, setBusy] = useState(false)

  // 接続中のスロット（順序 = スロット番号）。空きスロットを 1 つ余分に出す（最大 8）
  const inputs = useMemo(() => rfEdges
    .filter((e) => e.target === id && videoMergeSlotOf(e.targetHandle) !== null)
    .map((e) => { const n = rfNodes.find((x) => x.id === e.source); return { slot: videoMergeSlotOf(e.targetHandle)!, label: ((n?.data as Record<string, unknown> | undefined)?.label as string) || e.source, url: videoUrlOf(n?.data as Record<string, unknown> | undefined) } })
    .sort((a, b) => a.slot - b.slot), [rfEdges, rfNodes, id])
  const slotCount = Math.min(VIDEO_MERGE_MAX_INPUTS, Math.max(1, (inputs.length ? Math.max(...inputs.map((i) => i.slot)) : 0) + 1))
  const ready = inputs.filter((i) => !!i.url)

  const merge = useCallback(async () => {
    if (busy) return
    const urls = inputs.map((i) => i.url).filter((u): u is string => !!u)
    if (!urls.length) { showToast('結合する動画をつないでください', 'warning'); return }
    setBusy(true)
    const single = urls.length === 1
    updateNode(id, { status: 'generating', progress: single ? '' : '結合中…', error: null })
    const displayId = createResultNode(id, single ? '' : '結合中...')
    const setDisplay = (patch: Record<string, unknown>) => { if (displayId) updateNode(displayId, patch) }
    try {
      if (single) {
        // 1 本だけならそのまま通す（一括実行の「1 本ならコピー」と同じ）
        updateNode(id, { videoUrl: urls[0], status: 'idle', progress: '' })
        setDisplay({ status: 'completed', progress: '', videoUrl: urls[0], fileName: null, error: null })
        return
      }
      const fetchable = await Promise.all(urls.map((u) => fetchableUrl(u, workflowId)))
      const res = await fal.subscribe(MERGE_VIDEOS_ENDPOINT, { input: { video_urls: fetchable } })
      const out = (res as { data?: { video?: { url?: string; file_name?: string } } }).data?.video
      if (!out?.url) throw new Error('結合結果の動画がありません')
      const fileName = out.file_name ?? 'merged.mp4'
      updateNode(id, { videoUrl: out.url, fileName, status: 'idle', progress: '' })
      setDisplay({ status: 'completed', progress: '', videoUrl: out.url, fileName, error: null })
      const generationId = await saveGeneration({ nodeId: id, nodeType: 'video-merge', provider: 'fal', model: 'ffmpeg-merge', status: 'completed', outputUrl: out.url, inputParams: { inputs: urls.length } })
      if (workflowId) useWorkflowStore.getState().updateThumbnail(workflowId, out.url)
      // 保存して永続 URL に差し替え（fal の一時 URL は期限切れになる）
      uploadVideoFromUrl(out.url, displayId ?? id).then(async (storedUrl) => {
        const signed = await signOwnUpload(storedUrl)
        updateNode(id, { videoUrl: signed })
        setDisplay({ videoUrl: signed })
        if (generationId) updateGeneration(generationId, { output_url: storedUrl }).catch(() => {})
        if (workflowId) {
          useWorkflowStore.getState().updateThumbnail(workflowId, storedUrl)
          patchWorkflowNodeOutput(workflowId, id, { videoUrl: storedUrl }).catch(() => {})
          if (displayId) patchWorkflowNodeOutput(workflowId, displayId, { videoUrl: storedUrl }).catch(() => {})
        }
      }).catch(() => {
        showToast('結合した動画の保存に失敗しました。一時 URL は期限切れになる可能性があります', 'warning')
        if (generationId) updateGeneration(generationId, { output_url: null }).catch(() => {})
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      updateNode(id, { status: 'error', progress: '', error: message })
      setDisplay({ status: 'failed', progress: '', error: message })
      showToast(`結合に失敗しました: ${message}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, inputs, id, updateNode, workflowId])

  const generating = nodeData.status === 'generating'
  return (
    <div className={`node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible border transition-all duration-150 ${generating ? 'node-generating' : ''}`} style={{ background: 'var(--bg-surface)', borderColor: selected ? ACCENT : 'var(--border)', boxShadow: selected ? `0 0 0 1px ${ACCENT}44` : 'none' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]" style={{ minHeight: 36, borderLeft: `3px solid ${ACCENT}` }}>
        <Film size={14} className="shrink-0" style={{ color: ACCENT }} />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{nodeData.label || 'Video Merge'}</span>
        <button className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag" style={{ color: 'var(--text-tertiary)' }} onClick={() => useCanvasStore.getState().removeNode(id)} title="削除"><X size={12} /></button>
      </div>

      {/* 入力ハンドル: スロット順（接続数 + 1 の空き・最大 8） */}
      {Array.from({ length: slotCount }, (_, i) => i + 1).map((n) => (
        <Handle key={n} id={videoMergeSlotHandle(n)} type="target" position={Position.Left} title={`動画 ${n}（結合順）`} style={{ top: `${Math.round(((n) / (slotCount + 1)) * 100)}%`, ...HANDLE_STYLE(ACCENT) }} />
      ))}

      {/* Body */}
      <div className="px-3 py-3 flex flex-col gap-2">
        <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>つないだ動画を上から順に 1 本に結合します（最大 {VIDEO_MERGE_MAX_INPUTS} 本・音声なし・再エンコードなし）。結果は右に作る Video Result に出ます。一括実行では SKU ごとに結合します。</div>
        <div className="rounded-md px-2 py-1.5 flex flex-col gap-0.5" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
          {inputs.length === 0 && <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>動画をつないでください</div>}
          {inputs.map((i) => (
            <div key={i.slot} className="flex items-center gap-1.5 text-[11px] min-w-0">
              <span className="w-4 text-right tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>{i.slot}</span>
              <span className="truncate" style={{ color: 'var(--text-primary)' }} title={i.label}>{i.label}</span>
              <span className="ml-auto shrink-0 text-[10px]" style={{ color: i.url ? '#22C55E' : 'var(--text-tertiary)' }}>{i.url ? '準備完了' : '動画なし'}</span>
            </div>
          ))}
        </div>
        {generating && (
          <div className="flex items-center justify-center gap-2 rounded-lg py-3" style={{ border: '1px dashed rgba(236,72,153,0.4)', background: 'rgba(236,72,153,0.04)' }}>
            <Loader2 size={16} className="animate-spin" style={{ color: ACCENT }} />
            <span className="text-[11px]" style={{ color: ACCENT }}>{nodeData.progress || '結合中…'}</span>
          </div>
        )}
        {nodeData.status === 'error' && !generating && (
          <div className="flex items-center gap-2 rounded-lg py-2 px-2" style={{ border: '1px dashed rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.04)' }}>
            <AlertCircle size={14} style={{ color: '#EF4444' }} />
            <span className="text-[11px]" style={{ color: '#EF4444' }}>{nodeData.error || '結合に失敗しました'}</span>
          </div>
        )}
        <button
          className="h-9 w-full rounded-lg text-[12px] font-medium text-white nodrag disabled:opacity-50 transition-opacity hover:opacity-90 flex items-center justify-center gap-1.5"
          style={{ background: ACCENT }}
          disabled={busy || ready.length === 0}
          title={ready.length === 0 ? '結合する動画をつないでください' : ready.length === 1 ? '1 本だけなのでそのまま通します' : `${ready.length} 本を順に結合します`}
          onClick={() => void merge()}
        >
          <Play size={14} />結合（{ready.length} 本）
        </button>
      </div>

      {/* 出力ハンドル */}
      <Handle id="out-video" type="source" position={Position.Right} title="結合した動画" style={{ top: '50%', ...HANDLE_STYLE(ACCENT) }} />
    </div>
  )
}

export const VideoMergeNode = memo(function VideoMergeNodeWrapper(props: NodeProps) {
  return <div className="group"><VideoMergeNodeInner {...props} /></div>
})
