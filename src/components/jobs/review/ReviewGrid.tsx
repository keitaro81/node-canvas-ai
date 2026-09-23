import { memo } from 'react'
import { CircleNotch, Warning, XCircle } from '@phosphor-icons/react'
import type { BatchItemRow, BatchReview } from '../../../types/batch'
import { ITEM_STATUS_META, REVIEW_META } from '../../../types/batch'
import type { ReviewBg, ThumbState } from '../../../lib/review/reviewStore'
import { CUTOUT_VARIANT_KEY, thumbKey, type GridSelection, type ReviewVariant } from '../../../lib/review/model'
import { ACCENT, BG_STYLE, TILE_SIZE } from './reviewStyles'

interface Props {
  items: BatchItemRow[]
  variants: ReviewVariant[]
  thumbs: Record<string, ThumbState>
  bg: ReviewBg
  selection: GridSelection | null
  onSelect: (s: GridSelection) => void
  onOpen: (itemId: string, variantKey: string) => void
  onReview: (item: BatchItemRow, review: BatchReview) => void
  reviewing: string | null
  nameOf: (id: string | null) => string
}

function Tile({ thumb, bg, selected, onSelect, onOpen, item }: {
  thumb: ThumbState | undefined; bg: ReviewBg; selected: boolean; onSelect: () => void; onOpen: () => void; item: BatchItemRow
}) {
  const st = thumb?.status ?? 'waiting'
  const itemStatus = ITEM_STATUS_META[item.status]
  return (
    <div
      role="gridcell"
      tabIndex={-1}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className="relative rounded-lg overflow-hidden cursor-pointer select-none"
      style={{ width: TILE_SIZE, height: TILE_SIZE, ...BG_STYLE[bg], outline: selected ? `2px solid ${ACCENT}` : '1px solid var(--border)', outlineOffset: -1 }}
      title={thumb?.warnings?.length ? thumb.warnings.join('\n') : undefined}
    >
      {st === 'ready' && thumb?.url && (
        <img src={thumb.url} alt="" className="w-full h-full object-contain block" draggable={false} decoding="async" />
      )}
      {(st === 'queued' || st === 'rendering') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px]" style={{ color: '#374151', background: 'rgba(255,255,255,0.55)' }}>
          {thumb?.url ? <img src={thumb.url} alt="" className="absolute inset-0 w-full h-full object-contain opacity-40" draggable={false} /> : null}
          <CircleNotch size={16} className="animate-spin relative" />
          <span className="relative">{st === 'rendering' ? '描画中' : '待機中'}</span>
        </div>
      )}
      {st === 'waiting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px]" style={{ color: '#374151', background: 'rgba(255,255,255,0.6)' }}>
          {item.status === 'processing' && <CircleNotch size={16} className="animate-spin" />}
          <span>{item.status === 'processing' ? '処理中' : item.status === 'pending' ? '待機' : itemStatus.label}</span>
        </div>
      )}
      {st === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] px-2 text-center" style={{ color: '#B91C1C', background: 'rgba(255,255,255,0.7)' }}>
          <XCircle size={16} weight="fill" />
          <span>失敗</span>
        </div>
      )}
      {st === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] px-2 text-center" style={{ color: '#B45309', background: 'rgba(255,255,255,0.7)' }} title={thumb?.error}>
          <Warning size={16} weight="fill" />
          <span>描画エラー</span>
        </div>
      )}
      {!!thumb?.warnings?.length && st === 'ready' && (
        <span className="absolute top-1 right-1 inline-flex items-center gap-0.5 px-1 rounded text-[10px] font-semibold" style={{ color: '#fff', background: '#F59E0B' }}>
          <Warning size={10} weight="fill" />{thumb.warnings.length}
        </span>
      )}
    </div>
  )
}

/** 行 = アイテム、列 = 切り抜き + バリアント。クリックで選択、ダブルクリックで拡大 */
function ReviewGridInner({ items, variants, thumbs, bg, selection, onSelect, onOpen, onReview, reviewing, nameOf }: Props) {
  const cols = [{ key: CUTOUT_VARIANT_KEY, name: '切り抜き' }, ...variants.map((v) => ({ key: v.key, name: v.name }))]
  return (
    <div className="overflow-auto rounded-xl" style={{ border: '1px solid var(--border)' }} role="grid">
      <div style={{ display: 'grid', gridTemplateColumns: `240px repeat(${cols.length}, ${TILE_SIZE + 12}px)`, minWidth: 240 + cols.length * (TILE_SIZE + 12) }}>
        {/* header */}
        <div className="sticky top-0 z-10 px-3 py-2 text-[11px] font-medium" style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>アイテム</div>
        {cols.map((c) => (
          <div key={c.key} className="sticky top-0 z-10 px-2 py-2 text-[11px] font-medium truncate" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }} title={c.name}>{c.name}</div>
        ))}
        {items.map((item, row) => {
          const rm = REVIEW_META[item.review]
          const rowSelected = selection?.row === row
          return (
            <div key={item.id} style={{ display: 'contents' }}>
              <div className="px-3 py-2 flex flex-col gap-1 min-w-0" style={{ borderBottom: '1px solid var(--border)', background: rowSelected ? 'rgba(20,184,166,0.06)' : 'var(--bg-panel)' }}>
                <div className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={item.sku}>{item.sort_order}. {item.sku}</div>
                <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }} title={item.original_filename}>{item.original_filename}{item.width && item.height ? `・${item.width}×${item.height}` : ''}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  {(['ok', 'ng'] as BatchReview[]).map((r) => {
                    const on = item.review === r
                    const m = REVIEW_META[r]
                    return (
                      <button key={r} disabled={reviewing === item.id} onClick={(e) => { e.stopPropagation(); onReview(item, r) }}
                        className="h-6 px-2 rounded-md text-[11px] font-semibold disabled:opacity-60"
                        style={{ color: on ? '#fff' : m.color, background: on ? m.color : m.bg, border: `1px solid ${on ? m.color : 'transparent'}` }}
                        title={on ? `${m.label} を取り消す（キー: ${r === 'ok' ? 'O' : 'N'}）` : `${m.label} にする（キー: ${r === 'ok' ? 'O' : 'N'}）`}>
                        {m.label}
                      </button>
                    )
                  })}
                  {item.review === 'unreviewed'
                    ? <span className="text-[10px]" style={{ color: rm.color }}>{rm.label}</span>
                    : <span className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }} title={nameOf(item.reviewed_by)}>{nameOf(item.reviewed_by)}</span>}
                </div>
                {item.warnings.length > 0 && (
                  <div className="text-[10px] truncate" style={{ color: '#F59E0B' }} title={item.warnings.join('\n')}>⚠ {item.warnings[0]}{item.warnings.length > 1 ? ` 他 ${item.warnings.length - 1}` : ''}</div>
                )}
              </div>
              {cols.map((c, col) => (
                <div key={c.key} className="p-1.5 flex items-center justify-center" style={{ borderBottom: '1px solid var(--border)', background: rowSelected ? 'rgba(20,184,166,0.04)' : 'var(--bg-panel)' }}>
                  <Tile
                    thumb={thumbs[thumbKey(item.id, c.key)]}
                    bg={bg}
                    item={item}
                    selected={rowSelected && selection?.col === col}
                    onSelect={() => onSelect({ row, col })}
                    onOpen={() => onOpen(item.id, c.key)}
                  />
                </div>
              ))}
            </div>
          )
        })}
        {items.length === 0 && (
          <div className="px-3 py-8 text-center text-[12px]" style={{ gridColumn: `1 / span ${cols.length + 1}`, color: 'var(--text-tertiary)' }}>該当するアイテムがありません</div>
        )}
      </div>
    </div>
  )
}

export const ReviewGrid = memo(ReviewGridInner)
