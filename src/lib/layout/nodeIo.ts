// ProductLayoutNode の入出力ハンドルと、上流ノードからの切り抜き参照の取り出し。
import type { CutoutRef } from '../../types/nodes'

export const PRODUCT_LAYOUT_INPUT_CUTOUT = 'in-cutout-cutout'
export const PRODUCT_LAYOUT_INPUT_BACKGROUND = 'in-image-background'
export const PRODUCT_LAYOUT_OUTPUT = 'out-image-image'

/** 上流（RemoveBackgroundNode）の data.output が切り抜き参照の形をしていればそれを返す。 */
export function cutoutRefFromNodeData(d: Record<string, unknown> | undefined): CutoutRef | null {
  const o = d?.output
  if (!o || typeof o !== 'object') return null
  const r = o as Partial<CutoutRef>
  if (typeof r.maskPath !== 'string' || typeof r.sourceRef !== 'string') return null
  if (typeof r.width !== 'number' || typeof r.height !== 'number' || r.width <= 0 || r.height <= 0) return null
  return r as CutoutRef
}
