import { Play } from '@phosphor-icons/react'
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

export function GenerationCard({ generation }: GenerationCardProps) {
  const url = generation.output_url!
  const isVideo = isVideoUrl(url)

  return (
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
      onClick={() => window.open(url, '_blank')}
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
  )
}
