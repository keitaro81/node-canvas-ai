// ReviewGrid の描画の中身。Worker（OffscreenCanvas）でもメインスレッドでも同じ関数を使う。
// Step 2（アルファ抽出・しきい値・ぼかし・外接矩形）と Step 3（純関数のレイアウト計算・描画）をそのまま組み合わせる。
// メモリ: 1 アイテム分の画素（元画像 + 生マスク）だけを持ち、関数を抜けたら参照を残さない。
import type { ExportFormat, LayoutParams } from '../../types/nodes'
import { alphaFromLuminance, alphaFromRgba, processAlpha, resizeAlpha, type AlphaMap } from '../cutout/alpha'
import { canvasToPng, decodeBlob, fetchBlob, makeCanvas, renderTransparentPng, type AnyCanvas, type DecodedImage } from '../cutout/decode'
import { computeLayout, type LayoutPlan } from '../layout/computeLayout'
import { renderLayoutToPng } from '../layout/renderLayout'
import { encodeWithCap, loadBitmap } from '../export/encode'
import { CUTOUT_VARIANT_KEY } from './model'

export interface ItemAssetsInput { originalUrl: string; resultUrl: string; resultKind: 'mask' | 'rgba' }
export interface ItemAssets { original: DecodedImage; rawAlpha: AlphaMap }
export interface CutoutSpec { alphaThreshold: number; featherPx: number }
export interface VariantSpec { key: string; params: LayoutParams; backgroundUrl?: string | null }
export interface EncodeSpec { format: ExportFormat; quality: number; maxBytes: number | null }
export interface FullVariantSpec extends VariantSpec { encode?: EncodeSpec | null }

export interface ThumbResult { key: string; blob: Blob; warnings: string[]; scale: number; transparent: boolean; width: number; height: number }
export interface FullResult { key: string; blob: Blob; warnings: string[]; quality: number | null; format: ExportFormat }

/** 元画像と fal の結果（マスク or 透過画像）を読み、元解像度の生マスクにする（Step 2 と同じ手順） */
export async function loadItemAssets(input: ItemAssetsInput): Promise<ItemAssets> {
  const [original, result] = await Promise.all([fetchBlob(input.originalUrl).then(decodeBlob), fetchBlob(input.resultUrl).then(decodeBlob)])
  const alphaAtResult = input.resultKind === 'mask'
    ? alphaFromLuminance(result.rgba, result.width, result.height)
    : alphaFromRgba(result.rgba, result.width, result.height)
  const rawAlpha = resizeAlpha(alphaAtResult, original.width, original.height)
  return { original, rawAlpha }
}

async function loadBackground(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await fetchBlob(url), { colorSpaceConversion: 'default' })
}

async function toBlob(canvas: AnyCanvas, mime: string, quality?: number): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mime, quality })
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('エンコードに失敗しました'))), mime, quality))
}

function fitSize(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const s = Math.min(1, maxEdge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/** 計算 → 描画（PNG）。背景画像は呼び出し側で読み込んで渡す */
export async function renderVariantPng(assets: ItemAssets, cutout: CutoutSpec, variant: VariantSpec, background: ImageBitmap | null): Promise<{ blob: Blob; plan: LayoutPlan }> {
  const { bbox } = processAlpha(assets.rawAlpha, cutout)
  const plan = computeLayout({
    params: variant.params,
    source: { width: assets.original.width, height: assets.original.height },
    bbox,
    background: background ? { width: background.width, height: background.height } : null,
  })
  const blob = await renderLayoutToPng({ plan, original: assets.original, rawAlpha: assets.rawAlpha, cutout, background })
  return { blob, plan }
}

/** 出力 PNG → 長辺 maxEdge のサムネイル（50% ずつ段階縮小）。透過は PNG、それ以外は JPEG */
export async function downscaleToThumb(png: Blob, maxEdge: number, transparent: boolean): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(png)
  try {
    const target = fitSize(bmp.width, bmp.height, maxEdge)
    let cur: AnyCanvas | ImageBitmap = bmp
    let cw = bmp.width, ch = bmp.height
    while (cw / 2 >= target.w && ch / 2 >= target.h) {
      const nw = Math.max(1, Math.floor(cw / 2)), nh = Math.max(1, Math.floor(ch / 2))
      const step = makeCanvas(nw, nh)
      step.ctx.imageSmoothingEnabled = true; step.ctx.imageSmoothingQuality = 'high'
      step.ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh)
      cur = step.canvas; cw = nw; ch = nh
    }
    const { canvas, ctx } = makeCanvas(target.w, target.h)
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, target.w, target.h)
    const blob = transparent ? await canvasToPng(canvas) : await toBlob(canvas, 'image/jpeg', 0.85)
    return { blob, width: target.w, height: target.h }
  } finally {
    bmp.close()
  }
}

export interface ThumbsOptions { thumbMaxEdge: number; includeCutout: boolean; isCancelled?: () => boolean }

/** 1 アイテムの全バリアント（＋切り抜き列）のサムネイルを順に作り、できた順に通知する */
export async function renderItemThumbs(assets: ItemAssets, cutout: CutoutSpec, variants: VariantSpec[], opts: ThumbsOptions, onThumb: (t: ThumbResult) => void): Promise<void> {
  if (opts.includeCutout) {
    const { alpha } = processAlpha(assets.rawAlpha, cutout)
    const blob = await renderTransparentPng(assets.original, alpha, opts.thumbMaxEdge)
    const size = fitSize(assets.original.width, assets.original.height, opts.thumbMaxEdge)
    onThumb({ key: CUTOUT_VARIANT_KEY, blob, warnings: [], scale: 1, transparent: true, width: size.w, height: size.h })
  }
  for (const v of variants) {
    if (opts.isCancelled?.()) return
    const background = v.params.backgroundKind === 'image' && v.backgroundUrl ? await loadBackground(v.backgroundUrl) : null
    try {
      const { blob: png, plan } = await renderVariantPng(assets, cutout, v, background)
      const transparent = plan.background.kind === 'transparent'
      const t = await downscaleToThumb(png, opts.thumbMaxEdge, transparent)
      onThumb({ key: v.key, blob: t.blob, warnings: plan.warnings, scale: plan.scale, transparent, width: t.width, height: t.height })
    } finally {
      background?.close()
    }
  }
}

/** フル解像度（拡大表示・書き出し）。encode 指定があれば形式変換と容量上限（仕様 3-4）まで行う */
export async function renderItemFull(assets: ItemAssets, cutout: CutoutSpec, variants: FullVariantSpec[], onResult: (r: FullResult) => void, isCancelled?: () => boolean): Promise<void> {
  for (const v of variants) {
    if (isCancelled?.()) return
    if (v.key === CUTOUT_VARIANT_KEY) {
      const { alpha } = processAlpha(assets.rawAlpha, cutout)
      onResult({ key: v.key, blob: await renderTransparentPng(assets.original, alpha), warnings: [], quality: null, format: 'png' })
      continue
    }
    const background = v.params.backgroundKind === 'image' && v.backgroundUrl ? await loadBackground(v.backgroundUrl) : null
    try {
      const { blob: png, plan } = await renderVariantPng(assets, cutout, v, background)
      if (!v.encode) { onResult({ key: v.key, blob: png, warnings: plan.warnings, quality: null, format: 'png' }); continue }
      const bmp = await loadBitmap(png)
      try {
        let format = v.encode.format
        const warnings = [...plan.warnings]
        if (plan.background.kind === 'transparent' && format === 'jpeg') { format = 'png'; warnings.push('背景が透過のため PNG で書き出します') }
        const enc = await encodeWithCap(bmp, format, v.encode.quality, v.encode.maxBytes)
        onResult({ key: v.key, blob: enc.blob, warnings: [...warnings, ...enc.warnings], quality: enc.quality, format })
      } finally {
        bmp.close()
      }
    } finally {
      background?.close()
    }
  }
}
