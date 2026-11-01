// ポート名の表示（2026-11-01 メモ 7/16/31）: ノードにマウスを載せたとき、または線をドラッグ中に候補のポートに名前を出す
import type { CSSProperties } from 'react'

/** ポート名。show のとき（ドラッグ中の候補）は常に表示、それ以外はノードにマウスを載せたときだけ */
export function PortLabel({ top, at, text, show, style }: { top: string | number; at: 'input' | 'output'; text: string; show: boolean; style?: CSSProperties }) {
  return (
    <span
      className={`absolute pointer-events-none transition-opacity text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded ${show ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      style={{ top, [at === 'input' ? 'right' : 'left']: 'calc(100% + 8px)', transform: 'translateY(-50%)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', zIndex: 5, ...style }}
    >
      {text}
    </span>
  )
}

