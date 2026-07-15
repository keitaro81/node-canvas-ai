import { useState, useEffect, useRef } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { getMyGenerations, type GenerationWithWorkflow } from '../../lib/api/generations'
import { GenerationCard } from './GenerationCard'
import { useIsMobile } from '../../hooks/useIsMobile'

const PAGE_SIZE = 30

export function HistoryPage() {
  const isMobile = useIsMobile()
  const [generations, setGenerations] = useState<GenerationWithWorkflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 一括描画をやめ、初期 PAGE_SIZE 件＋スクロールで追加読み込み（DOM/描画コスト削減）
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    getMyGenerations()
      .then(setGenerations)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  // 末尾センチネルが見えたら次ページ分を表示（画像は loading="lazy" で近づいた時だけ取得）
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || visibleCount >= generations.length) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleCount((c) => c + PAGE_SIZE) },
      { rootMargin: '600px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [visibleCount, generations.length])

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
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {generations.slice(0, visibleCount).map((g) => (
                <GenerationCard
                  key={g.id}
                  generation={g}
                  onDeleted={(id) => setGenerations((prev) => prev.filter((x) => x.id !== id))}
                />
              ))}
            </div>
            {/* 追加読み込み: 近づくと自動（IntersectionObserver）／クリックでも読み込める */}
            {visibleCount < generations.length && (
              <div ref={sentinelRef} className="flex items-center justify-center py-6">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px]"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                >
                  <CircleNotch size={14} className="animate-spin" />
                  さらに読み込む（残り {generations.length - visibleCount} 件）
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
