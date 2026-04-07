import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, Download, ArrowsOut, X } from '@phosphor-icons/react'
import type { GenerationWithWorkflow } from '../../lib/api/generations'

interface GenerationCardProps {
  generation: GenerationWithWorkflow
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

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

export function GenerationCard({ generation }: GenerationCardProps) {
  const url = generation.output_url!
  const isVideo = isVideoUrl(url)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const filename = isVideo
    ? `generation-${generation.id.slice(0, 8)}.mp4`
    : `generation-${generation.id.slice(0, 8)}.png`

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    downloadFile(url, filename)
  }

  return (
    <>
      <div
        className="group flex flex-col rounded-xl overflow-hidden cursor-pointer transition-all duration-150"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)'
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
        }}
        onClick={() => setLightboxOpen(true)}
      >
        {/* Media thumbnail */}
        <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1', background: '#0A0A0B' }}>
          {isVideo ? (
            <>
              <video
                src={url}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                  style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
                >
                  <Play size={16} weight="fill" color="#fff" />
                </div>
              </div>
            </>
          ) : (
            <img src={url} alt="" className="w-full h-full object-cover" />
          )}

          {/* Hover overlay with action buttons */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
              style={{ background: 'rgba(255,255,255,0.15)' }}
              onClick={handleDownload}
              title="ダウンロード"
            >
              <Download size={15} weight="bold" />
            </button>
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
              style={{ background: 'rgba(255,255,255,0.15)' }}
              onClick={(e) => { e.stopPropagation(); setLightboxOpen(true) }}
              title="拡大表示"
            >
              <ArrowsOut size={15} weight="bold" />
            </button>
          </div>

          {/* Type badge */}
          <div
            className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{
              background: 'rgba(0,0,0,0.5)',
              color: isVideo ? '#EC4899' : '#8B5CF6',
              backdropFilter: 'blur(4px)',
            }}
          >
            {isVideo ? 'Video' : 'Image'}
          </div>
        </div>

        {/* Info */}
        <div className="px-3 py-2">
          <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {generation.workflow_name}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {formatDate(generation.created_at)}
          </p>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && createPortal(
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
            {isVideo ? (
              <video
                src={url}
                controls
                autoPlay
                style={{ maxWidth: '90vw', maxHeight: '90vh', display: 'block' }}
              />
            ) : (
              <img
                src={url}
                alt=""
                style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', display: 'block' }}
              />
            )}

            {/* Action buttons */}
            <div className="absolute top-3 right-3 flex gap-2">
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={(e) => { e.stopPropagation(); downloadFile(url, filename) }}
                title="ダウンロード"
              >
                <Download size={15} weight="bold" />
              </button>
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                style={{ background: 'rgba(0,0,0,0.6)' }}
                onClick={() => setLightboxOpen(false)}
                title="閉じる"
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* Bottom info bar */}
            <div
              className="absolute bottom-0 left-0 right-0 px-4 py-3 flex items-center justify-between"
              style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            >
              <div>
                <p className="text-[13px] font-medium text-white">{generation.workflow_name}</p>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {formatDate(generation.created_at)}
                </p>
              </div>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white transition-colors"
                style={{ background: 'rgba(139,92,246,0.8)' }}
                onClick={(e) => { e.stopPropagation(); downloadFile(url, filename) }}
              >
                <Download size={13} weight="bold" />
                Download
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
