import { ArrowsClockwise, DownloadSimple, Selection, SlidersHorizontal, X } from '@phosphor-icons/react'
import type { ExportScope } from '../../../lib/review/exportJob'

interface Props {
  counts: { all: number; failed: number }
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

const BTN = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-50'
const GHOST = 'h-7 px-2 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 hover:bg-[var(--bg-elevated)]'

/** 確認グリッドのツールバー（1 行）: 左にチェックの操作、右にダウンロード。チェック数の表示・表示背景の切替・サムネイルの進み・絞り込みは出さない（2026-10-04 ユーザー指示）。「失敗を選択」は失敗があるときだけ */
export function ReviewToolbar({ counts, readyCount, selectedCount, busy, canRerun, onSelectAll, onSelectFailed, onClearSelection, onExport, onRerunSelected, onSettings, compact }: Props) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${compact ? 'px-3 py-2' : 'px-8 py-2.5'} border-b shrink-0 text-[11px]`} style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
      {/* 1 行: 左にチェックの操作（1 枚でもチェックすると「再度切り抜く」「ダウンロード」が出る）、右にダウンロード */}
      <button className={GHOST} style={{ color: 'var(--text-secondary)' }} onClick={onSelectAll} disabled={busy || counts.all === 0} title="表示中の写真をすべてチェック"><span className="inline-flex items-center gap-1"><Selection size={12} />すべて選択</span></button>
      {counts.failed > 0 && (
        <button className={GHOST} style={{ color: '#EF4444' }} onClick={onSelectFailed} disabled={busy} title="失敗した写真をチェック">失敗を選択</button>
      )}
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
          </button>
        )
      })}
    </div>
  )
}
