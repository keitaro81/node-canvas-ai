// レイアウト描画（ブラウザ実装・Canvas 2D）。計算結果（LayoutPlan）に従い 背景 → 影 → 商品 の順に描く。
// 将来サーバー実装を足せるよう LayoutRenderer インターフェースで差し替え可能にしておく（仕様 4-10）。
import { compositeRgba, processAlpha, type AlphaMap } from '../cutout/alpha'
import { canvasToPng, makeCanvas, type Any2D, type AnyCanvas, type DecodedImage } from '../cutout/decode'
import type { LayoutPlan } from './computeLayout'
import { contactShadowAlpha, dropShadowAlpha } from './shadow'

export interface RenderLayoutInput {
  plan: LayoutPlan
  original: DecodedImage                              // 元画像（sRGB にデコード済み）
  rawAlpha: AlphaMap                                  // 生マスク（元解像度）
  cutout: { alphaThreshold: number; featherPx: number } // 切り抜き側のしきい値/ぼかし
  background?: ImageBitmap | null                     // backgroundKind='image' のとき
}

export interface LayoutRenderer {
  render(input: RenderLayoutInput): Promise<Blob>
}

/** アルファ平面を単色レイヤー（RGB 固定・A=alpha）としてキャンバスに描く。 */
function drawAlphaLayer(ctx: Any2D, alpha: AlphaMap, rgb: [number, number, number]): void {
  const { canvas, ctx: lctx } = makeCanvas(alpha.width, alpha.height)
  const img = lctx.createImageData(alpha.width, alpha.height)
  const d = img.data
  for (let i = 0; i < alpha.data.length; i++) {
    const o = i * 4
    d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = alpha.data[i]
  }
  lctx.putImageData(img, 0, 0)
  ctx.drawImage(canvas, 0, 0)
}

/**
 * 商品を描く。
 * - 倍率 1.0: 整数座標に再サンプリングなしで写す（商品内部の画素値は元画像と一致。仕様 7 章）
 * - 縮小: 50% ずつ段階的に縮小してから最終サイズへ（大幅な縮小でも荒れない）
 */
async function drawProduct(ctx: Any2D, plan: LayoutPlan, original: DecodedImage, alpha: AlphaMap): Promise<void> {
  const { canvas: pc, ctx: pctx } = makeCanvas(original.width, original.height)
  const img = pctx.createImageData(original.width, original.height)
  img.data.set(compositeRgba(original.rgba, alpha))
  pctx.putImageData(img, 0, 0)

  if (plan.scale === 1) {
    ctx.drawImage(pc, Math.round(plan.productRect.x), Math.round(plan.productRect.y))
    return
  }
  let cur: AnyCanvas = pc
  let cw = original.width
  let ch = original.height
  const targetW = plan.productRect.width
  const targetH = plan.productRect.height
  while (cw / 2 >= targetW && ch / 2 >= targetH) {
    const nw = Math.max(1, Math.floor(cw / 2))
    const nh = Math.max(1, Math.floor(ch / 2))
    const step = makeCanvas(nw, nh)
    step.ctx.imageSmoothingEnabled = true
    step.ctx.imageSmoothingQuality = 'high'
    step.ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh)
    cur = step.canvas; cw = nw; ch = nh
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, cw, ch, plan.productRect.x, plan.productRect.y, targetW, targetH)
}

export async function renderLayoutToPng(input: RenderLayoutInput): Promise<Blob> {
  const { plan } = input
  const { canvas, ctx } = makeCanvas(plan.canvas.width, plan.canvas.height)

  // 背景
  if (plan.background.kind === 'color') {
    ctx.fillStyle = plan.background.color
    ctx.fillRect(0, 0, plan.canvas.width, plan.canvas.height)
  } else if (plan.background.kind === 'image' && input.background) {
    const d = plan.background.destRect
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(input.background, d.x, d.y, d.width, d.height)
  }

  // 影（マスクから決定的に。しきい値適用後のアルファを使う）
  const { alpha } = processAlpha(input.rawAlpha, input.cutout)
  if (plan.shadow?.kind === 'drop') drawAlphaLayer(ctx, dropShadowAlpha(alpha, plan), [0, 0, 0])
  else if (plan.shadow?.kind === 'contact') drawAlphaLayer(ctx, contactShadowAlpha(plan), [0, 0, 0])

  // 商品
  await drawProduct(ctx, plan, input.original, alpha)
  return canvasToPng(canvas)
}

export const browserLayoutRenderer: LayoutRenderer = { render: renderLayoutToPng }
