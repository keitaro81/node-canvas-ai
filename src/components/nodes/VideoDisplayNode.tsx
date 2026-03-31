import { memo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, useNodes, useEdges, type NodeProps } from '@xyflow/react'
import { MonitorPlay, Play, Pause, RotateCcw, Download, Maximize2, Video as VideoIcon, X, Volume2, VolumeX } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import type { VideoDisplayNodeData, VideoGenerationNodeData } from '../../types/nodes'

async function downloadFile(url: string, filename: string) {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank')
  }
}

function VideoDisplayNodeInner({ id, data }: NodeProps) {
  const nodeData = data as unknown as VideoDisplayNodeData
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const updateNode = useCanvasStore((s) => s.updateNode)

  // 接続元 VideoGenerationNode の videoUrl をリアクティブに読む
  // → 後から接続した場合や生成完了後に接続した場合でも表示される
  const rfNodes = useNodes()
  const rfEdges = useEdges()
  const incomingEdge = rfEdges.find((e) => e.target === id && e.targetHandle === 'in-video')
  const sourceNode = incomingEdge ? rfNodes.find((n) => n.id === incomingEdge.source) : null
  const sourceVideoUrl = sourceNode
    ? ((sourceNode.data as unknown as VideoGenerationNodeData).videoUrl ?? null)
    : null
  const sourceFileName = sourceNode
    ? ((sourceNode.data as unknown as VideoGenerationNodeData).fileName as string | null ?? null)
    : null

  // 接続元の URL を優先し、なければノード自身に保存された URL を使う
  const videoUrl = sourceVideoUrl ?? nodeData.videoUrl ?? null
  const fileName = sourceFileName ?? nodeData.fileName ?? null

  useEffect(() => {
    if (videoUrl && videoRef.current && nodeData.autoPlay) {
      videoRef.current.play().catch(() => {})
    }
  }, [videoUrl, nodeData.autoPlay])

  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play()
    } else {
      videoRef.current.pause()
    }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!videoUrl) return
    downloadFile(videoUrl, fileName || 'video.mp4')
  }

  return (
    <>
      <div
        className="node-popin relative flex flex-col w-[320px] rounded-xl overflow-visible border border-[#27272A] transition-all duration-150"
        style={{ background: '#111113' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[#27272A]" style={{ minHeight: 36 }}>
          <MonitorPlay size={14} className="shrink-0" style={{ color: '#EC4899' }} />
          <span className="flex-1 text-[13px] font-semibold text-[#FAFAFA] truncate">{nodeData.label}</span>
        </div>

        {/* Input handle */}
        <Handle
          id="in-video"
          type="target"
          position={Position.Left}
          style={{
            top: '50%',
            width: 20,
            height: 20,
            background: 'radial-gradient(circle, #EC4899 3px, #111113 3px 5px, transparent 5px)',
            border: 'none',
            borderRadius: 0,
          }}
        />

        {/* Body */}
        <div className="px-3 py-3 flex flex-col gap-2">
          {videoUrl ? (
            <>
              {/* Video player with hover overlay */}
              <div
                className="relative rounded-lg overflow-hidden group/vid cursor-pointer"
                style={{ background: '#000', border: '1px solid #27272A' }}
                onClick={() => setLightboxOpen(true)}
              >
                <video
                  ref={videoRef}
                  src={videoUrl}
                  loop={nodeData.loop}
                  muted={nodeData.muted}
                  playsInline
                  className="w-full h-auto block"
                  style={{ maxHeight: 200, objectFit: 'contain' }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
                {/* Hover overlay */}
                <div
                  className="absolute inset-0 opacity-0 group-hover/vid:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2"
                  style={{ background: 'rgba(0,0,0,0.6)' }}
                >
                  <button
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white nodrag"
                    style={{ background: 'rgba(255,255,255,0.15)' }}
                    onClick={handleDownload}
                    title="ダウンロード"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white nodrag"
                    style={{ background: 'rgba(255,255,255,0.15)' }}
                    onClick={(e) => { e.stopPropagation(); setLightboxOpen(true) }}
                    title="拡大再生"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1.5">
                {/* Play/Pause */}
                <button
                  className="w-7 h-7 rounded flex items-center justify-center transition-colors nodrag"
                  style={{ background: '#1E1E22' }}
                  onClick={togglePlay}
                  title={isPlaying ? '一時停止' : '再生'}
                >
                  {isPlaying ? (
                    <Pause size={12} style={{ color: '#A1A1AA' }} />
                  ) : (
                    <Play size={12} style={{ color: '#A1A1AA' }} />
                  )}
                </button>

                {/* Loop */}
                <button
                  className="w-7 h-7 rounded flex items-center justify-center transition-colors nodrag"
                  style={{
                    background: nodeData.loop ? 'rgba(236,72,153,0.2)' : '#1E1E22',
                    color: nodeData.loop ? '#EC4899' : '#71717A',
                    border: `1px solid ${nodeData.loop ? 'rgba(236,72,153,0.4)' : 'transparent'}`,
                  }}
                  onClick={() => updateNode(id, { loop: !nodeData.loop } as Parameters<typeof updateNode>[1])}
                  title="ループ"
                >
                  <RotateCcw size={12} />
                </button>

                {/* Mute */}
                <button
                  className="w-7 h-7 rounded flex items-center justify-center transition-colors nodrag"
                  style={{
                    background: nodeData.muted ? '#1E1E22' : 'rgba(236,72,153,0.2)',
                    color: nodeData.muted ? '#71717A' : '#EC4899',
                    border: `1px solid ${nodeData.muted ? 'transparent' : 'rgba(236,72,153,0.4)'}`,
                  }}
                  onClick={() => {
                    updateNode(id, { muted: !nodeData.muted } as Parameters<typeof updateNode>[1])
                    if (videoRef.current) {
                      videoRef.current.muted = !nodeData.muted
                    }
                  }}
                  title={nodeData.muted ? 'ミュート解除' : 'ミュート'}
                >
                  {nodeData.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>

                {/* Filename */}
                {fileName && (
                  <span className="ml-auto text-[10px] text-[#71717A] truncate" style={{ maxWidth: 100 }}>
                    {fileName}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg py-8"
              style={{ border: '1px dashed #27272A', minHeight: 140 }}
            >
              <VideoIcon size={32} color="#3F3F46" />
              <span className="text-[11px] text-[#71717A]">ビデオを待っています...</span>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox — portal でスタッキングコンテキストを脱出 */}
      {lightboxOpen && videoUrl && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)', zIndex: 99999 }}
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative rounded-xl overflow-hidden"
            style={{ maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <video
              src={videoUrl}
              controls
              autoPlay
              loop={nodeData.loop}
              style={{ maxWidth: '90vw', maxHeight: '90vh', display: 'block' }}
            />
            <div className="absolute top-3 right-3 flex gap-2">
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center text-white nodrag"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={(e) => { e.stopPropagation(); downloadFile(videoUrl, fileName || 'video.mp4') }}
                title="ダウンロード"
              >
                <Download size={14} />
              </button>
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={() => setLightboxOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export const VideoDisplayNode = memo(function VideoDisplayNodeWrapper(props: NodeProps) {
  return (
    <div className="group">
      <VideoDisplayNodeInner {...props} />
    </div>
  )
})
