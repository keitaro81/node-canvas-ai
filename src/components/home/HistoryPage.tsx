import { useState, useEffect } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { getMyGenerations, type GenerationWithWorkflow } from '../../lib/api/generations'
import { GenerationCard } from './GenerationCard'

export function HistoryPage() {
  const [generations, setGenerations] = useState<GenerationWithWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMyGenerations()
      .then(setGenerations)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div
        className="flex items-center justify-between px-8 py-5 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            History
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            All your generated images and videos
          </p>
        </div>
        {generations.length > 0 && (
          <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {generations.length} generations
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-[13px]" style={{ color: 'var(--accent-error)' }}>{error}</p>
          </div>
        ) : generations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>No generations yet</p>
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Generated images and videos will appear here
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {generations.map((g) => (
              <GenerationCard key={g.id} generation={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
