import { memo, useEffect, useRef } from 'react'
import { CircleNotch, Warning, XCircle } from '@phosphor-icons/react'
import type { BatchItemRow } from '../../../types/batch'
import { ITEM_STATUS_META } from '../../../types/batch'
import type { ReviewBg, ThumbState } from '../../../lib/review/reviewStore'
import { CUTOUT_VARIANT_KEY, thumbKey, type ReviewVariant } from '../../../lib/review/model'
import { ACCENT, BG_STYLE } from './reviewStyles'

export const CARD_MIN_WIDTH = 220
export const CARD_GAP = 12

interface Props {
  items: BatchItemRow[]
  variants: ReviewVariant[]
  activeKey: string                      // 表示中の列（CUTOUT_VARIANT_KEY か Product Layout ノードの id）
  thumbs: Record<string, ThumbState>
  bg: ReviewBg
  selected: ReadonlySet<string>          // チェックした写真（アイテム id）
  onToggle: (itemId: string) => void
  focusId: string | null                 // キーボード操作の現在位置
  onFocus: (itemId: string) => void
  onOpen: (itemId: string) => void
  onColumns?: (n: number) => void        // 1 行のカード数（矢印キーの上下移動用）
}

/** サムネイル部分（状態の重ね表示つき） */
function Thumb({ thumb, item }: { thumb: ThumbState | undefined; item: BatchItemRow }) {
  const st = thumb?.status ?? 'waiting'
  const itemStatus = ITEM_STATUS_META[item.status]
  return (
    <>
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
        <span className="absolute top-1 right-1 inline-flex items-center gap-0.5 px-1 rounded text-[10px] font-semibold" style={{ color: '#fff', background: '#F59E0B' }} title={thumb.warnings.join('\n')}>
          <Warning size={10} weight="fill" />{thumb.warnings.length}
        </span>
      )}
    </>
  )
}

/** 1 列ぶんのカードグリッド（仕様 5 章の確認グリッド・2026-10 改訂）: 写真ごとに 1 枚。チェックで再切り抜き/書き出しの対象にする。ダブルクリックで拡大 */
function ReviewGridInner({ items, variants, activeKey, thumbs, bg, selected, onToggle, focusId, onFocus, onOpen, onColumns }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const variant = activeKey === CUTOUT_VARIANT_KEY ? null : variants.find((v) => v.key === activeKey) ?? null
  // 1 行のカード数を測る（矢印キーの上下移動に使う）
  useEffect(() => {
    if (!ref.current || !onColumns) return
    const el = ref.current
    const report = () => onColumns(Math.max(1, Math.floor((el.clientWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP))))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onColumns])
  // フォーカスしたカードを見える位置へ
  useEffect(() => {
    if (!focusId || !ref.current) return
    ref.current.querySelector<HTMLElement>(`[data-item-id="${focusId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  return (
    <div ref={ref} role="grid" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH}px, 1fr))`, gap: CARD_GAP }}>
      {items.map((item) => {
        const focused = focusId === item.id
        const checked = selected.has(item.id)
        const w = variant ? variant.params.width : item.width ?? null
        const h = variant ? variant.params.height : item.height ?? null
        const aspect = w && h ? `${w} / ${h}` : '1 / 1'
        return (
          <div
            key={item.id}
            data-item-id={item.id}
            role="gridcell"
            tabIndex={-1}
            onClick={() => onFocus(item.id)}
            onDoubleClick={() => onOpen(item.id)}
            className="rounded-xl overflow-hidden cursor-pointer select-none flex flex-col"
            style={{ background: 'var(--bg-panel)', outline: focused ? `2px solid ${ACCENT}` : checked ? '2px solid rgba(20,184,166,0.45)' : '1px solid var(--border)', outlineOffset: -1 }}
          >
            <div className="flex items-center gap-2 px-2.5 h-9 min-w-0">
              <input
                type="checkbox"
                checked={checked}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggle(item.id)}
                className="w-4 h-4 shrink-0 cursor-pointer"
                style={{ accentColor: ACCENT }}
                title={checked ? 'チェックを外す（Space）' : 'チェックする（Space）: 再度切り抜く / 書き出す対象'}
                aria-label={`${item.sku} をチェック`}
              />
              <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={`${item.sort_order}. ${item.sku}`}>{item.sort_order}. {item.sku}</span>
              <span className="ml-auto text-[11px] tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>{w && h ? `${w}×${h}` : ''}</span>
            </div>
            <div className="relative w-full" style={{ ...BG_STYLE[bg], aspectRatio: aspect, maxHeight: 420 }}>
              <div className="absolute inset-0">
                <Thumb thumb={thumbs[thumbKey(item.id, activeKey)]} item={item} />
              </div>
            </div>
            <div className="px-2.5 py-1.5 min-w-0">
              <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }} title={item.original_filename}>{item.original_filename}</div>
              {item.warnings.length > 0 && (
                <div className="text-[10px] truncate" style={{ color: '#F59E0B' }} title={item.warnings.join('\n')}>⚠ {item.warnings[0]}{item.warnings.length > 1 ? ` 他 ${item.warnings.length - 1}` : ''}</div>
              )}
            </div>
          </div>
        )
      })}
      {items.length === 0 && (
        <div className="px-3 py-8 text-center text-[12px]" style={{ gridColumn: '1 / -1', color: 'var(--text-tertiary)' }}>該当する写真がありません</div>
      )}
    </div>
  )
}

export const ReviewGrid = memo(ReviewGridInner)
