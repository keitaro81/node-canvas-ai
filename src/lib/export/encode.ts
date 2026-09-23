// 書き出し用の形式変換（ブラウザ・Canvas API）。
import type { ExportFormat } from '../../types/nodes'
import { makeCanvas, type AnyCanvas } from '../cutout/decode'
import { MIME_OF, qualitySteps } from './naming'

export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { colorSpaceConversion: 'default' })
}

/** アルファが 255 でない画素があるか（全画素を見る）。 */
export function bitmapHasTransparency(bmp: ImageBitmap): boolean {
  const { ctx } = makeCanvas(bmp.width, bmp.height)
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true
  return false
}

async function toBlob(canvas: AnyCanvas, mime: string, quality?: number): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mime, quality })
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('エンコードに失敗しました'))), mime, quality)
  })
}

/** 形式変換。JPEG は透明部分が黒くならないよう白で塗ってから描く。quality は 0〜100（PNG では無視）。 */
export async function encodeBitmap(bmp: ImageBitmap, format: ExportFormat, quality: number): Promise<Blob> {
  const { canvas, ctx } = makeCanvas(bmp.width, bmp.height)
  if (format === 'jpeg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, bmp.width, bmp.height) }
  ctx.drawImage(bmp, 0, 0)
  return toBlob(canvas, MIME_OF[format], format === 'png' ? undefined : quality / 100)
}

export interface EncodeOutcome { blob: Blob; quality: number | null; warnings: string[] }

const kb = (b: number) => Math.round(b / 1024)

/** 最大サイズ指定時は品質を段階的に下げて収める（下限 70）。PNG は品質が無いので超過なら警告のみ。 */
export async function encodeWithCap(bmp: ImageBitmap, format: ExportFormat, startQuality: number, maxBytes: number | null): Promise<EncodeOutcome> {
  if (format === 'png') {
    const blob = await encodeBitmap(bmp, 'png', 100)
    const warnings = maxBytes && blob.size > maxBytes ? [`PNG は品質調整ができないため上限 ${kb(maxBytes)}KB を超えています（${kb(blob.size)}KB）`] : []
    return { blob, quality: null, warnings }
  }
  let last: Blob | null = null
  let lastQ = startQuality
  for (const q of qualitySteps(startQuality)) {
    const b = await encodeBitmap(bmp, format, q)
    last = b; lastQ = q
    if (!maxBytes || b.size <= maxBytes) return { blob: b, quality: q, warnings: [] }
  }
  return { blob: last as Blob, quality: lastQ, warnings: [`品質 70 まで下げても上限 ${kb(maxBytes as number)}KB を超えています（${kb((last as Blob).size)}KB）`] }
}
