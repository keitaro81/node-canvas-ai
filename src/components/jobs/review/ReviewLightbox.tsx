import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowsLeftRight, CaretLeft, CaretRight, CircleNotch, X } from '@phosphor-icons/react'
import type { BatchItemRow, BatchReview } from '../../../types/batch'
import { REVIEW_META } from '../../../types/batch'
import type { ReviewBg, ThumbState } from '../../../lib/review/reviewStore'
import { CUTOUT_VARIANT_KEY, type ReviewVariant } from '../../../lib/review/model'
import type { FullResult } from '../../../lib/review/renderCore'
import { BG_LABEL, BG_ORDER, BG_STYLE } from './reviewStyles'

interface Props {
  item: BatchItemRow
  variantKey: string
  variants: ReviewVariant[]
  thumb: ThumbState | undefined
  bg: ReviewBg
  onBg: (bg: ReviewBg) => void
  originalUrl: string | null
  renderFull: (itemId: string, variantKey: string) => Promise<FullResult>
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onVariant: (key: string) => void
  onReview: (review: BatchReview) => void
  hasPrev: boolean
  hasNext: boolean
}

/** 拡大表示（仕様 5 章）: フル解像度をその場で描き、元画像と比較する。キー: ←→ アイテム、↑↓ バリアント、O/N 判定、C 比較、Esc 閉じる */
export function ReviewLightbox(p: Props) {
  const { item, variantKey, variants, thumb, bg, onBg, originalUrl, renderFull, onClose, onPrev, onNext, onVariant, onReview, hasPrev, hasNext } = p
  const reqKey = `${item.id}|${variantKey}`
  // フル解像度の描画結果（表示中の 1 枚だけ保持。切替・閉じるで解放）。読み込み中は reqKey と一致しない
  const [full, setFull] = useState<{ key: string; url: string; warnings: string[] } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [compare, setCompare] = useState(false)
  const urlRef = useRef<string | null>(null)
  const cols = useMemo(() => [{ key: CUTOUT_VARIANT_KEY, name: '切り抜き' }, ...variants.map((v) => ({ key: v.key, name: v.name }))], [variants])
  const colIdx = cols.findIndex((c) => c.key === variantKey)
  const fullUrl = full?.key === reqKey ? full.url : null
  const warnings = full?.key === reqKey ? full.warnings : []
  const error = failure?.key === reqKey ? failure.message : null
  const loading = !fullUrl && !error

  useEffect(() => {
    let alive = true
    renderFull(item.id, variantKey)
      .then((r) => {
        if (!alive) return
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        const u = URL.createObjectURL(r.blob)
        urlRef.current = u
        setFull({ key: reqKey, url: u, warnings: r.warnings })
      })
      .catch((e) => { if (alive) setFailure({ key: reqKey, message: e instanceof Error ? e.message : String(e) }) })
    return () => { alive = false }
  }, [item.id, variantKey, reqKey, renderFull])
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (hasPrev) onPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (hasNext) onNext() }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const n = e.key === 'ArrowUp' ? colIdx - 1 : colIdx + 1; if (n >= 0 && n < cols.length) onVariant(cols[n].key) }
      else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); onReview('ok') }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); onReview('ng') }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); setCompare((c) => !c) }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); onBg(BG_ORDER[(BG_ORDER.indexOf(bg) + 1) % BG_ORDER.length]) }
      e.stopPropagation()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose, onPrev, onNext, onVariant, onReview, hasPrev, hasNext, colIdx, cols, bg, onBg])

  const shown = compare ? originalUrl : (fullUrl ?? thumb?.url ?? null)
  const bgStyle = compare ? { background: '#808080' } : BG_STYLE[bg]
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: 'rgba(0,0,0,0.85)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* header */}
      <div className="flex items-center gap-3 px-4 h-12 shrink-0 text-[12px]" style={{ color: '#E5E7EB' }}>
        <span className="font-semibold">{item.sort_order}. {item.sku}</span>
        <span style={{ color: '#9CA3AF' }}>{item.original_filename}</span>
        <div className="flex items-center gap-1 ml-2">
          {cols.map((c) => (
            <button key={c.key} onClick={() => onVariant(c.key)} className="h-7 px-2.5 rounded-md text-[11px] font-medium" style={{ background: c.key === variantKey ? 'rgba(255,255,255,0.18)' : 'transparent', color: c.key === variantKey ? '#fff' : '#9CA3AF' }}>{c.name}</button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {BG_ORDER.map((b) => <button key={b} onClick={() => onBg(b)} className="w-5 h-5 rounded" title={`背景: ${BG_LABEL[b]}`} style={{ ...BG_STYLE[b], border: bg === b ? '2px solid #14B8A6' : '1px solid rgba(255,255,255,0.4)' }} />)}
        </div>
        <button onClick={() => setCompare((c) => !c)} className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium" style={{ background: compare ? '#14B8A6' : 'rgba(255,255,255,0.12)', color: '#fff' }} title="元画像と比較（キー: C）">
          <ArrowsLeftRight size={13} />{compare ? '元画像を表示中' : '元画像と比較'}
        </button>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: '#E5E7EB' }} title="閉じる（Esc）"><X size={16} /></button>
      </div>
      {/* body */}
      <div className="flex-1 min-h-0 flex items-center justify-center gap-2 px-4">
        <button onClick={onPrev} disabled={!hasPrev} className="w-10 h-10 flex items-center justify-center rounded-full disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} title="前のアイテム（←）"><CaretLeft size={18} /></button>
        <div className="relative rounded-lg overflow-hidden flex items-center justify-center" style={{ ...bgStyle, maxWidth: 'calc(100vw - 160px)', maxHeight: 'calc(100vh - 150px)', width: 'min(1100px, calc(100vw - 160px))', height: 'calc(100vh - 150px)' }}>
          {shown ? <img src={shown} alt="" className="max-w-full max-h-full object-contain block" draggable={false} /> : null}
          {loading && !compare && (
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded px-2 py-1 text-[11px] text-white" style={{ background: 'rgba(0,0,0,0.6)' }}><CircleNotch size={12} className="animate-spin" />フル解像度を描画中…</div>
          )}
          {error && <div className="absolute bottom-2 left-2 rounded px-2 py-1 text-[11px] text-white" style={{ background: 'rgba(239,68,68,0.85)' }}>{error}</div>}
        </div>
        <button onClick={onNext} disabled={!hasNext} className="w-10 h-10 flex items-center justify-center rounded-full disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} title="次のアイテム（→）"><CaretRight size={18} /></button>
      </div>
      {/* footer */}
      <div className="flex items-center gap-3 px-4 h-14 shrink-0 text-[12px]" style={{ color: '#E5E7EB' }}>
        {(['ok', 'ng'] as BatchReview[]).map((r) => {
          const on = item.review === r
          const m = REVIEW_META[r]
          return (
            <button key={r} onClick={() => onReview(r)} className="h-8 px-4 rounded-lg text-[12px] font-semibold" style={{ color: on ? '#fff' : m.color, background: on ? m.color : 'rgba(255,255,255,0.12)', border: `1px solid ${on ? m.color : 'transparent'}` }} title={`${m.label}（キー: ${r === 'ok' ? 'O' : 'N'}）`}>
              {m.label}
            </button>
          )
        })}
        <span style={{ color: '#9CA3AF' }}>{item.review === 'unreviewed' ? '未確認' : `${REVIEW_META[item.review].label}`}</span>
        {warnings.length > 0 && <span className="truncate" style={{ color: '#F59E0B' }} title={warnings.join('\n')}>⚠ {warnings.join(' / ')}</span>}
        <div className="flex-1" />
        <span style={{ color: '#6B7280' }}>← → アイテム・↑ ↓ バリアント・O / N 判定・C 比較・B 背景・Esc 閉じる</span>
      </div>
    </div>,
    document.body,
  )
}
