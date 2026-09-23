// 撮影後工程ノード共通のスタイル定数
import type { CSSProperties, KeyboardEvent } from 'react'

export const PP_ACCENT = '#14B8A6'
export const INPUT_STYLE: CSSProperties = { background: 'var(--bg-canvas)', border: '1px solid var(--border)' }
export const CTRL = 'h-8 rounded-md px-2 text-[12px] text-[var(--text-primary)] focus:outline-none nodrag nopan'
export const CHECKER: CSSProperties = {
  backgroundColor: '#FFFFFF',
  backgroundImage:
    'linear-gradient(45deg,#CCCCCC 25%,transparent 25%),linear-gradient(-45deg,#CCCCCC 25%,transparent 25%),' +
    'linear-gradient(45deg,transparent 75%,#CCCCCC 75%),linear-gradient(-45deg,transparent 75%,#CCCCCC 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}
/** テキスト/数値入力のキー操作をキャンバスのショートカットに渡さない */
export const stopKeys = (e: KeyboardEvent) => e.stopPropagation()
