import type { CSSProperties } from 'react'
import { CHECKER } from '../../nodes/pp/styles'
import type { ReviewBg } from '../../../lib/review/reviewStore'

/** 表示背景（仕様 5 章: 白 / グレー / 市松。白背景商品の切り抜き漏れを見つけやすくする） */
export const BG_STYLE: Record<ReviewBg, CSSProperties> = {
  white: { background: '#FFFFFF' },
  gray: { background: '#808080' },
  checker: CHECKER,
}
export const BG_LABEL: Record<ReviewBg, string> = { white: '白', gray: 'グレー', checker: '市松' }
export const BG_ORDER: ReviewBg[] = ['white', 'gray', 'checker']
export const TILE_SIZE = 150
export const ACCENT = '#14B8A6'
