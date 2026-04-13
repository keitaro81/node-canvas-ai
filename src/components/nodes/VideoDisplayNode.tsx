import { memo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { MonitorPlay, Play, Pause, RotateCcw, Download, Maximize2, Video as VideoIcon, X, Volume2, VolumeX, Loader2, AlertCircle } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import type { VideoDisplayNodeData } from '../../types/nodes'

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

  const videoUrl = nodeData.videoUrl ?? null
  const fileName = nodeData.fileName ?? null
  const isGenerating = nodeData.status === 'queued' || nodeData.status === 'processing'
  const isError = nodeData.status === 'failed'

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
        className="node-popin relative flex flex-col w-[320px] rounded-xl overflow-visible border border-[var(--border)] transition-all duration-150"
        style={{ background: 'var(--bg-surface)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]" style={{ minHeight: 36 }}>
          <MonitorPlay size={14} className="shrink-0" style={{ color: '#EC4899' }} />
          <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{nodeData.label}</span>
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
            background: 'radial-gradient(circle, #EC4899 3px, var(--bg-surface) 3px 5px, transparent 5px)',
            border: 'none',
            borderRadius: 0,
          }}
        />

        {/* Body */}
        <div className="px-3 py-3 flex flex-col gap-2">
          {isGenerating ? (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg py-8"
              style={{ border: '1px dashed rgba(236,72,153,0.4)', minHeight: 140, background: 'rgba(236,72,153,0.04)' }}
            >
              <Loader2 size={24} className="animate-spin" style={{ color: '#EC4899' }} />
              <span className="text-[11px]" style={{ color: '#EC4899' }}>{nodeData.progress || '生成中...'}</span>
            </div>
          ) : isError ? (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg py-8"
              style={{ border: '1px dashed rgba(239,68,68,0.4)', minHeight: 140, background: 'rgba(239,68,68,0.04)' }}
            >
              <AlertCircle size={24} style={{ color: '#EF4444' }} />
              <span className="text-[11px] text-center px-2" style={{ color: '#EF4444' }}>{nodeData.error || '生成に失敗しました'}</span>
            </div>
          ) : videoUrl ? (
            <>
              {/* Video player with hover overlay */}
              <div
                className="relative rounded-lg overflow-hidden group/vid cursor-pointer"
                style={{ background: '#000', border: '1px solid var(--border)' }}
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
                <button
                  className="w-7 h-7 rounded flex items-center justify-center transition-colors nodrag"
                  style={{ background: 'var(--bg-elevated)' }}
                  onClick={togglePlay}
                  title={isPlaying ? '一時停止' : '再生'}
                >
                  {isPlaying ? (
                    <Pause size={12} style={{ color: 'var(--text-secondary)' }} />
                  ) : (
                    <Play size={12} style={{ color: 'var(--text-secondary)' }} />
                  )}
                </button>

                <button
                  className="w-7 h-7 rounded flex items-center justify-center transition-colors nodrag"
                  style={{
                    background: nodeData.loop ? 'rgba(236,72,153,0.2)' : 'var(--bg-elevated)',
                    color: nodeData.loop ? '#EC4899' : 'var(--text-tertiary)',
                    border: `1px solid ${nodeData.loop ? 'rgba(236,72,153,0.4)' : 'transparent'}`,
                  }}
                  onClick={() => updateNode(id, { loop: !nodeData.loop } as Parameters<typeof updateNode>[1])}
                  title="ループ"
                >
                  <RotateCcw size={12} />
                </button>

                <button
                  className="w-7 h-7 rounded flex items-center justify-center transition-colors nodrag"
                  style={{
                    background: nodeData.muted ? 'var(--bg-elevated)' : 'rgba(236,72,153,0.2)',
                    color: nodeData.muted ? 'var(--text-tertiary)' : '#EC4899',
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

                {fileName && (
                  <span className="ml-auto text-[10px] text-[var(--text-tertiary)] truncate" style={{ maxWidth: 100 }}>
                    {fileName}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg py-8"
              style={{ border: '1px dashed var(--border)', minHeight: 140 }}
            >
              <VideoIcon size={32} color="var(--border-active)" />
              <span className="text-[11px] text-[var(--text-tertiary)]">ビデオを待っています...</span>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
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
