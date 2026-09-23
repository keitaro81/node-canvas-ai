import { ArrowsClockwise, CircleNotch, DownloadSimple, SlidersHorizontal } from '@phosphor-icons/react'
import type { ReviewBg } from '../../../lib/review/reviewStore'
import type { ReviewFilter } from '../../../lib/review/model'
import { BG_LABEL, BG_ORDER, BG_STYLE } from './reviewStyles'

interface Props {
  bg: ReviewBg
  onBg: (bg: ReviewBg) => void
  filter: ReviewFilter
  onFilter: (f: ReviewFilter) => void
  counts: { all: number; ok: number; ng: number; unreviewed: number; failed: number }
  progress: { done: number; total: number; running: boolean }
  executorKind: 'worker' | 'main' | null
  readyCount: number
  busy: boolean
  onExport: (scope: 'ok' | 'all') => void
  onRerun: () => void
  onSettings: () => void
}

const FILTERS: Array<[ReviewFilter, string]> = [['all', 'すべて'], ['ok', 'OK'], ['ng', 'NG'], ['unreviewed', '未確認'], ['failed', '失敗']]
const BTN = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-50'

export function ReviewToolbar({ bg, onBg, filter, onFilter, counts, progress, executorKind, readyCount, busy, onExport, onRerun, onSettings }: Props) {
  return (
    <div className="flex items-center gap-3 flex-wrap px-8 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-1" title="表示背景（キー: B）">
        {BG_ORDER.map((b) => (
          <button key={b} onClick={() => onBg(b)} className="w-6 h-6 rounded" title={`背景: ${BG_LABEL[b]}`} style={{ ...BG_STYLE[b], border: bg === b ? '2px solid #14B8A6' : '1px solid rgba(0,0,0,0.35)' }} />
        ))}
      </div>
      <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {FILTERS.map(([f, label]) => (
          <button key={f} onClick={() => onFilter(f)} className="h-7 px-2.5 text-[11px] font-medium transition-colors" style={{ background: filter === f ? 'var(--bg-elevated)' : 'transparent', color: filter === f ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {label} <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{counts[f]}</span>
          </button>
        ))}
      </div>
      <span className="text-[11px] tabular-nums flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
        {progress.running && <CircleNotch size={12} className="animate-spin" />}
        サムネイル {progress.done} / {progress.total}{executorKind === 'main' ? '（ワーカー非対応のため画面側で描画）' : ''}
      </span>
      <div className="flex-1" />
      <button className={BTN} style={{ color: 'var(--text-primary)', border: '1px solid var(--border-active)' }} onClick={onSettings} disabled={busy} title="バリアントのレイアウト設定を変更して全アイテムに再適用（fal は呼びません）">
        <SlidersHorizontal size={14} />レイアウト設定
      </button>
      <button className={BTN} style={{ color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)' }} onClick={onRerun} disabled={busy || counts.ng === 0} title="NG のアイテムだけを、エンジンやパラメータを変えて再実行">
        <ArrowsClockwise size={14} />NG のみ再実行（{counts.ng}）
      </button>
      <button className={BTN} style={{ color: 'var(--text-primary)', border: '1px solid var(--border-active)' }} onClick={() => onExport('ok')} disabled={busy || counts.ok === 0} title="OK を付けたアイテムだけをフル解像度で書き出し">
        <DownloadSimple size={14} />OK のみ書き出し（{counts.ok}）
      </button>
      <button className={`${BTN} text-white`} style={{ background: 'var(--accent)' }} onClick={() => onExport('all')} disabled={busy || readyCount === 0} title="準備完了の全アイテムをフル解像度で書き出し">
        <DownloadSimple size={14} />すべて書き出し（{readyCount}）
      </button>
    </div>
  )
}
