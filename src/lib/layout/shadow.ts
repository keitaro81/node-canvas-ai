// 影の生成（純関数・型付き配列）。仕様 3-3「影はすべてマスクから決定的に作る（AI は使わない）」。
// ドロップシャドウ = マスクを出力倍率に合わせ、ずらして、ぼかしたもの。接地影 = 外接矩形の下端に置く楕円をぼかしたもの。
import { featherAlpha, resizeAlpha, type AlphaMap } from '../cutout/alpha'
import type { LayoutPlan, Rect } from './computeLayout'

/** 「ぼかし px」→ ボックスぼかし（×2 ≒ ガウス）の半径。 */
export function blurRadiusOf(blurPx: number): number {
  return Math.max(0, Math.round(blurPx / 2))
}

function applyOpacity(a: AlphaMap, opacity: number): AlphaMap {
  const o = Math.min(1, Math.max(0, opacity))
  const data = new Uint8ClampedArray(a.data.length)
  for (let i = 0; i < data.length; i++) data[i] = a.data[i] * o
  return { width: a.width, height: a.height, data }
}

/** キャンバス大のアルファ平面に、別のアルファ平面を (dx, dy) に貼り付ける（範囲外は捨てる）。 */
export function blitAlpha(dst: AlphaMap, src: AlphaMap, dx: number, dy: number): void {
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy)
  const x1 = Math.min(dst.width, dx + src.width), y1 = Math.min(dst.height, dy + src.height)
  for (let y = y0; y < y1; y++) {
    const srow = (y - dy) * src.width - dx
    const drow = y * dst.width
    for (let x = x0; x < x1; x++) dst.data[drow + x] = src.data[srow + x]
  }
}

/**
 * ドロップシャドウのアルファ（キャンバス大）。商品のマスク（元解像度）を productRect の大きさに縮小し、
 * (offsetX, offsetY) ずらして置き、ぼかして濃さを掛ける。
 */
export function dropShadowAlpha(mask: AlphaMap, plan: LayoutPlan): AlphaMap {
  if (!plan.shadow || plan.shadow.kind !== 'drop') throw new Error('dropShadowAlpha: plan.shadow is not drop')
  const { width, height } = plan.canvas
  const w = Math.max(1, Math.round(plan.productRect.width))
  const h = Math.max(1, Math.round(plan.productRect.height))
  const scaled = resizeAlpha(mask, w, h)
  const canvasAlpha: AlphaMap = { width, height, data: new Uint8ClampedArray(width * height) }
  blitAlpha(canvasAlpha, scaled, Math.round(plan.productRect.x + plan.shadow.offsetX), Math.round(plan.productRect.y + plan.shadow.offsetY))
  const blurred = featherAlpha(canvasAlpha, blurRadiusOf(plan.shadow.blur))
  return applyOpacity(blurred, plan.shadow.opacity)
}

/** 楕円を塗ったアルファ平面（キャンバス大）。 */
export function ellipseAlpha(canvas: { width: number; height: number }, e: Rect): AlphaMap {
  const data = new Uint8ClampedArray(canvas.width * canvas.height)
  const cx = e.x + e.width / 2, cy = e.y + e.height / 2
  const rx = Math.max(0.5, e.width / 2), ry = Math.max(0.5, e.height / 2)
  const y0 = Math.max(0, Math.floor(e.y)), y1 = Math.min(canvas.height - 1, Math.ceil(e.y + e.height))
  const x0 = Math.max(0, Math.floor(e.x)), x1 = Math.min(canvas.width - 1, Math.ceil(e.x + e.width))
  for (let y = y0; y <= y1; y++) {
    const ny = (y + 0.5 - cy) / ry
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx
      if (nx * nx + ny * ny <= 1) data[y * canvas.width + x] = 255
    }
  }
  return { width: canvas.width, height: canvas.height, data }
}

/** 接地影のアルファ（キャンバス大）: 外接矩形の下端に置く楕円をぼかして濃さを掛ける。 */
export function contactShadowAlpha(plan: LayoutPlan): AlphaMap {
  if (!plan.shadow || plan.shadow.kind !== 'contact') throw new Error('contactShadowAlpha: plan.shadow is not contact')
  const base = ellipseAlpha(plan.canvas, plan.shadow.ellipse)
  const blurred = featherAlpha(base, blurRadiusOf(plan.shadow.blur))
  return applyOpacity(blurred, plan.shadow.opacity)
}
