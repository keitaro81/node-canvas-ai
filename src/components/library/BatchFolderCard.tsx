// ライブラリの「一括処理のフォルダ」の見た目（2026-10-31）: 中の画像を 3 枚ずらして重ねたカード。クリックで中身のダイアログ（BatchFolderDialog）。
// ライブラリの生成画像タブ（BatchFolderCard）と「画像を追加」ダイアログの AI 画像生成（FolderTile）で同じ重ね方（FolderStack）を使う
import { ArrowSquareOut, FolderOpen, Images } from '@phosphor-icons/react'
import type { BatchFolder } from '../../lib/api/batchFolders'
import { formatRelativeJa } from '../../lib/batch/dates'
import { folderTitle } from '../../lib/batch/folders'
import { MediaImg } from '../ui/MediaImg'

const LAYERS = [
  { rotate: -6, dx: -7, dy: -5 },   // 奥
  { rotate: 4, dx: 7, dy: -2 },
  { rotate: 0, dx: 0, dy: 3 },      // 手前
]

/** 重ねたサムネイル（最大 3 枚・白い紙の上）と「一括処理 ・ n 枚」の印。足りない分は無地の紙 */
export function FolderStack({ urls, count, compact = false }: { urls: string[]; count: number; compact?: boolean }) {
  const layers = [2, 1, 0].map((i) => urls[i] ?? null)
  return (
    <div className="absolute inset-0" style={{ padding: compact ? '11%' : '13%' }}>
      <div className="relative w-full h-full">
        {layers.map((u, i) => (
          <div key={i} className="absolute inset-0 rounded-md overflow-hidden" style={{ transform: `translate(${LAYERS[i].dx}%, ${LAYERS[i].dy}%) rotate(${LAYERS[i].rotate}deg)`, background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.25)', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}>
            {u
              ? <MediaImg src={u} className="w-full h-full object-cover" draggable={false} fallback={<div className="w-full h-full" style={{ background: '#F4F4F5' }} />} />
              : i === 2 && !urls.length ? <div className="w-full h-full flex items-center justify-center" style={{ color: '#A1A1AA' }}><Images size={compact ? 18 : 26} /></div> : null}
          </div>
        ))}
      </div>
      <span className="absolute left-2 bottom-2 px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(20,184,166,0.92)' }}>一括処理 ・ {count} 枚</span>
    </div>
  )
}

/** ライブラリの生成画像タブのカード（他のカードと同じ大きさ）。クリックで開く。ホバーで「開く」「結果の画面で開く」 */
export function BatchFolderCard({ folder, urls, mine, onOpen, onOpenResults }: { folder: BatchFolder; urls: string[]; mine: boolean; onOpen: () => void; onOpenResults: () => void }) {
  return (
    <div
      className="group flex flex-col rounded-xl overflow-hidden transition-all duration-150 cursor-pointer"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      title={`${folderTitle(folder)}（クリックで中を開く）`}
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--bg-placeholder)' }}>
        <FolderStack urls={urls} count={folder.itemCount} />
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <button className="h-8 px-3 rounded-lg text-[12px] font-medium text-white flex items-center gap-1.5" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={(e) => { e.stopPropagation(); onOpen() }} title="フォルダを開く"><FolderOpen size={15} weight="bold" />開く</button>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={(e) => { e.stopPropagation(); onOpenResults() }} title="結果の画面で開く"><ArrowSquareOut size={15} weight="bold" /></button>
        </div>
        {!mine && <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>チーム</span>}
      </div>
      <div className="px-3 py-2">
        <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={folder.jobName}>{folderTitle(folder)}</p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{formatRelativeJa(folder.createdAt)} ・ {folder.itemCount} 枚{folder.status === 'partial_failed' ? ' ・ 一部失敗' : ''}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>処理の履歴と一緒に保持（削除は履歴から）</p>
      </div>
    </div>
  )
}

/** 「画像を追加」ダイアログのタイル（他のタイルと同じ大きさ）。クリックで中身のダイアログが上に重なる */
export function FolderTile({ folder, urls, isTeam, onOpen }: { folder: BatchFolder; urls: string[]; isTeam: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="relative rounded-lg overflow-hidden text-left focus:outline-none" style={{ aspectRatio: '1 / 1', background: 'var(--bg-placeholder)', outline: '1px solid var(--border)', outlineOffset: -1 }} title={`${folderTitle(folder)} ・ ${folder.itemCount} 枚（クリックで中を開く）`}>
      <FolderStack urls={urls} count={folder.itemCount} compact />
      {isTeam && <span className="absolute top-1.5 right-1.5 px-1.5 rounded text-[9px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>チーム</span>}
    </button>
  )
}
