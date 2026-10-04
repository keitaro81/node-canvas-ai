import { ArrowsClockwise, CheckSquare, CircleNotch, DownloadSimple, Selection, SlidersHorizontal, X } from '@phosphor-icons/react'
import type { ReviewBg } from '../../../lib/review/reviewStore'
import type { ReviewFilter } from '../../../lib/review/model'
import type { ExportScope } from '../../../lib/review/exportJob'
import { BG_LABEL, BG_ORDER, BG_STYLE } from './reviewStyles'

interface Props {
  bg: ReviewBg
  onBg: (bg: ReviewBg) => void
  filter: ReviewFilter
  onFilter: (f: ReviewFilter) => void
  counts: { all: number; failed: number }
  progress: { done: number; total: number; running: boolean }
  executorKind: 'worker' | 'main' | null
  readyCount: number
  selectedCount: number
  busy: boolean
  canRerun: boolean
  onSelectAll: () => void
  onSelectFailed: () => void
  onClearSelection: () => void
  onExport: (scope: ExportScope) => void
  onRerunSelected: () => void
  onSettings?: () => void                // 無ければ「レイアウト設定」ボタンを出さない（一括結果ノード: レイアウトはキャンバスのノードで変える）
  compact?: boolean                      // ノード内: 余白を詰める
}

const FILTERS: Array<[ReviewFilter, string]> = [['all', 'すべて'], ['failed', '失敗']]
const BTN = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-50'
const GHOST = 'h-7 px-2 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 hover:bg-[var(--bg-elevated)]'

/** 確認グリッドのツールバー: 表示背景・絞り込み・サムネイルの進み・チェックの操作・書き出し */
export function ReviewToolbar({ bg, onBg, filter, onFilter, counts, progress, executorKind, readyCount, selectedCount, busy, canRerun, onSelectAll, onSelectFailed, onClearSelection, onExport, onRerunSelected, onSettings, compact }: Props) {
  return (
    <div className={`flex flex-col gap-2 ${compact ? 'px-3 py-2' : 'px-8 py-2.5'} border-b shrink-0`} style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1" title="表示背景（キー: B）">
          {BG_ORDER.map((b) => (
            <button key={b} onClick={() => onBg(b)} className="w-6 h-6 rounded" title={`背景: ${BG_LABEL[b]}`} style={{ ...BG_STYLE[b], border: bg === b ? '2px solid #14B8A6' : '1px solid rgba(0,0,0,0.35)' }} />
          ))}
        </div>
        <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {FILTERS.map(([f, label]) => (
            <button key={f} onClick={() => onFilter(f)} className="h-7 px-2.5 text-[11px] font-medium transition-colors" style={{ background: filter === f ? 'var(--bg-elevated)' : 'transparent', color: filter === f ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {label} <span className="tabular-nums" style={{ color: f === 'failed' && counts.failed ? '#EF4444' : 'var(--text-tertiary)' }}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <span className="text-[11px] tabular-nums flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
          {progress.running && <CircleNotch size={12} className="animate-spin" />}
          サムネイル {progress.done} / {progress.total}{executorKind === 'main' ? '（ワーカー非対応のため画面側で描画）' : ''}
        </span>
        <div className="flex-1" />
        {onSettings && (
          <button className={BTN} style={{ color: 'var(--text-primary)', border: '1px solid var(--border-active)' }} onClick={onSettings} disabled={busy} title="バリアントのレイアウト設定を変更して全アイテムに再適用（fal は呼びません）">
            <SlidersHorizontal size={14} />レイアウト設定
          </button>
        )}
        <button className={`${BTN} text-white`} style={{ background: 'var(--accent)' }} onClick={() => onExport('all')} disabled={busy || readyCount === 0} title="準備完了の全写真をフル解像度でダウンロード（ZIP）">
          <DownloadSimple size={14} />すべてダウンロード（{readyCount}）
        </button>
      </div>
      {/* チェックの操作: 1 枚でもチェックすると「再度切り抜く」「書き出し」が出る */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <CheckSquare size={14} style={{ color: selectedCount ? '#14B8A6' : 'var(--text-tertiary)' }} />
        <span className="tabular-nums font-medium" style={{ color: selectedCount ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{selectedCount ? `${selectedCount} 枚をチェック中` : 'チェックなし'}</span>
        <button className={GHOST} style={{ color: 'var(--text-secondary)' }} onClick={onSelectAll} disabled={busy || counts.all === 0} title="表示中の写真をすべてチェック"><span className="inline-flex items-center gap-1"><Selection size={12} />すべて選択</span></button>
        <button className={GHOST} style={{ color: 'var(--text-secondary)' }} onClick={onSelectFailed} disabled={busy || counts.failed === 0} title="失敗した写真をチェック">失敗を選択</button>
        {selectedCount > 0 && (
          <>
            <button className={GHOST} style={{ color: 'var(--text-secondary)' }} onClick={onClearSelection} disabled={busy}><span className="inline-flex items-center gap-1"><X size={12} />解除</span></button>
            <span className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />
            <button className={BTN} style={{ color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)' }} onClick={onRerunSelected} disabled={busy || !canRerun} title={canRerun ? 'チェックした写真の切り抜きだけを、エンジンや設定を変えてやり直す（他の写真には影響しません）' : 'この処理には切り抜きのノードが無いためやり直せません'}>
              <ArrowsClockwise size={14} />チェックした {selectedCount} 枚を再度切り抜く
            </button>
            <button className={BTN} style={{ color: 'var(--text-primary)', border: '1px solid var(--border-active)' }} onClick={() => onExport('selected')} disabled={busy} title="チェックした写真だけをフル解像度でダウンロード（ZIP）">
              <DownloadSimple size={14} />チェックした {selectedCount} 枚をダウンロード
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** 列のタブ（切り抜き + バリアント）。1 列ずつ表示する */
export function ReviewTabs({ tabs, activeKey, onChange }: { tabs: Array<{ key: string; name: string; size?: string | null }>; activeKey: string; onChange: (key: string) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap mb-3" role="tablist">
      {tabs.map((t) => {
        const active = t.key === activeKey
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-colors"
            style={{ background: active ? 'var(--text-primary)' : 'var(--bg-elevated)', color: active ? 'var(--bg-surface)' : 'var(--text-secondary)', border: active ? '1px solid var(--text-primary)' : '1px solid var(--border)' }}
            title={t.size ? `${t.name}（${t.size}）` : t.name}
          >
            {t.name}
            {t.size && <span className="text-[10px] tabular-nums" style={{ opacity: 0.7 }}>{t.size}</span>}
          </button>
        )
      })}
    </div>
  )
}
