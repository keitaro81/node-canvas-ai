// ブラウザ側の画像デコード/エンコード（Canvas API）。純関数は alpha.ts、ここは DOM/OffscreenCanvas 依存。
import { compositeRgba, resizeAlpha, type AlphaMap } from './alpha'

export interface DecodedImage {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

// 4000×4000 の商品写真（16MP・RGBA 64MB）を想定。これを大きく超えるものは明示的に断る。
const MAX_PIXELS = 64 * 1024 * 1024

export async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`画像の取得に失敗しました (${res.status})`)
  return res.blob()
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Any2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function makeCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: Any2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('OffscreenCanvas 2D context を取得できません')
    return { canvas, ctx }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context を取得できません')
  return { canvas, ctx }
}

async function canvasToPng(canvas: AnyCanvas): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG エンコードに失敗しました'))), 'image/png')
  })
}

/**
 * 画像を RGBA 画素列にデコードする。
 * colorSpaceConversion:'none' で ICC 変換を避け（Adobe RGB 画像の値をそのまま持つ）、
 * premultiplyAlpha:'none' で半透明画素の RGB を保つ。アルファは常に正確に取れる。
 */
export async function decodeBlob(blob: Blob): Promise<DecodedImage> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  try {
    const { width, height } = bmp
    if (width * height > MAX_PIXELS) throw new Error(`画像が大きすぎます（${width}×${height}）。長辺 8000px 以下にしてください`)
    const { ctx } = makeCanvas(width, height)
    ctx.drawImage(bmp, 0, 0)
    const img = ctx.getImageData(0, 0, width, height)
    return { width, height, rgba: img.data }
  } finally {
    bmp.close()
  }
}

/** アルファ平面を輝度 PNG（R=G=B=alpha, A=255）にエンコードする。生マスクの保存形式。 */
export async function encodeGrayPng(alpha: AlphaMap): Promise<Blob> {
  const { canvas, ctx } = makeCanvas(alpha.width, alpha.height)
  const img = ctx.createImageData(alpha.width, alpha.height)
  const d = img.data
  for (let i = 0; i < alpha.data.length; i++) {
    const v = alpha.data[i]
    const o = i * 4
    d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvasToPng(canvas)
}

/**
 * 元画像にアルファを適用した透過 PNG を作る。maxEdge を渡すと長辺をその画素数に縮小する（サムネイル用）。
 * フル解像度では RGB を書き換えない（原則2。半透明画素の PNG 保存時のプリマルチプライ丸めは避けられない）。
 */
export async function renderTransparentPng(original: DecodedImage, alpha: AlphaMap, maxEdge?: number): Promise<Blob> {
  const rgba = compositeRgba(original.rgba, alpha)
  const { canvas, ctx } = makeCanvas(original.width, original.height)
  const img = ctx.createImageData(original.width, original.height)
  img.data.set(rgba)
  ctx.putImageData(img, 0, 0)
  if (!maxEdge || Math.max(original.width, original.height) <= maxEdge) return canvasToPng(canvas)

  const scale = maxEdge / Math.max(original.width, original.height)
  const w = Math.max(1, Math.round(original.width * scale))
  const h = Math.max(1, Math.round(original.height * scale))
  const small = makeCanvas(w, h)
  small.ctx.imageSmoothingEnabled = true
  small.ctx.imageSmoothingQuality = 'high'
  small.ctx.drawImage(canvas, 0, 0, w, h)
  return canvasToPng(small.canvas)
}

/** 保存済みの輝度 PNG（生マスク）をアルファ平面に戻す。寸法が違えば合わせ込む。 */
export async function decodeMaskPng(blob: Blob, width: number, height: number): Promise<AlphaMap> {
  const img = await decodeBlob(blob)
  const n = img.width * img.height
  const data = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) data[i] = img.rgba[i * 4]
  return resizeAlpha({ width: img.width, height: img.height, data }, width, height)
}
