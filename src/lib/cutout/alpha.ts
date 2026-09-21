// 背景切り抜きの共通処理（DOM 非依存の純関数）。対話実行・一括実行（Worker 可）の両方から使う。
// 原則2「商品ピクセル不変」: ここでは元画像の RGB を一切書き換えず、アルファ（マスク）だけを扱う。
import type { CutoutBBox } from '../../types/nodes'

/** 8bit のアルファ（マスク）平面。0=透明（背景）、255=不透明（商品）。 */
export interface AlphaMap {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** RGBA 画素列からアルファチャネルだけを取り出す（透過 PNG を返すエンジン用）。 */
export function alphaFromRgba(rgba: Uint8ClampedArray, width: number, height: number): AlphaMap {
  const n = width * height
  const data = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) data[i] = rgba[i * 4 + 3]
  return { width, height, data }
}

/** マスク画像（白=前景・黒=背景）の輝度をアルファとみなす（マスクを直接返すエンジン用）。 */
export function alphaFromLuminance(rgba: Uint8ClampedArray, width: number, height: number): AlphaMap {
  const n = width * height
  const data = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    data[i] = (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3
  }
  return { width, height, data }
}

/**
 * アルファ平面を別解像度へ合わせ込む（バイリニア）。
 * エンジンの出力解像度に上限があっても（Bria=1024px）、元画像の解像度でマスクを持つために使う。
 */
export function resizeAlpha(src: AlphaMap, width: number, height: number): AlphaMap {
  if (src.width === width && src.height === height) return src
  if (width <= 0 || height <= 0) throw new Error('resizeAlpha: invalid size')
  const data = new Uint8ClampedArray(width * height)
  const sx = src.width / width
  const sy = src.height / height
  const maxX = src.width - 1
  const maxY = src.height - 1
  for (let y = 0; y < height; y++) {
    const fy = Math.min(maxY, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(maxY, y0 + 1)
    const wy = fy - y0
    const row0 = y0 * src.width
    const row1 = y1 * src.width
    for (let x = 0; x < width; x++) {
      const fx = Math.min(maxX, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(maxX, x0 + 1)
      const wx = fx - x0
      const top = src.data[row0 + x0] * (1 - wx) + src.data[row0 + x1] * wx
      const bottom = src.data[row1 + x0] * (1 - wx) + src.data[row1 + x1] * wx
      data[y * width + x] = top * (1 - wy) + bottom * wy
    }
  }
  return { width, height, data }
}

const clampByte = (v: number) => Math.min(255, Math.max(0, Math.round(v)))

/** しきい値以下のアルファ値を 0 にする（仕様 3-2「これ以下のアルファ値を0として扱う」）。薄いノイズ除去。 */
export function applyThreshold(a: AlphaMap, threshold: number): AlphaMap {
  const t = clampByte(threshold)
  const data = new Uint8ClampedArray(a.data.length)
  for (let i = 0; i < a.data.length; i++) data[i] = a.data[i] <= t ? 0 : a.data[i]
  return { width: a.width, height: a.height, data }
}

/** 1 次元ボックスぼかし（端は端の値で埋める）。2 回重ねてガウス近似にする。 */
function boxBlur1D(src: Float32Array, width: number, height: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length)
  const len = horizontal ? width : height
  const lines = horizontal ? height : width
  const div = 2 * r + 1
  const clampI = (i: number) => (i < 0 ? 0 : i > len - 1 ? len - 1 : i)
  for (let l = 0; l < lines; l++) {
    const at = (i: number) => (horizontal ? l * width + i : i * width + l)
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[at(clampI(k))]
    for (let i = 0; i < len; i++) {
      out[at(i)] = sum / div
      sum += src[at(clampI(i + r + 1))] - src[at(clampI(i - r))]
    }
  }
  return out
}

/** 縁のぼかし（半径 px のボックスぼかし×2 ≒ ガウス）。0 なら同じものを返す。 */
export function featherAlpha(a: AlphaMap, radiusPx: number): AlphaMap {
  const r = Math.max(0, Math.round(radiusPx))
  if (r === 0) return a
  let cur: Float32Array = Float32Array.from(a.data)
  for (let pass = 0; pass < 2; pass++) {
    cur = boxBlur1D(cur, a.width, a.height, r, true)
    cur = boxBlur1D(cur, a.width, a.height, r, false)
  }
  const data = new Uint8ClampedArray(a.data.length)
  for (let i = 0; i < data.length; i++) data[i] = cur[i]
  return { width: a.width, height: a.height, data }
}

/** アルファ値がしきい値を超える画素の外接矩形（仕様 2 章）。該当画素が無ければ null。 */
export function computeBbox(a: AlphaMap, threshold: number): CutoutBBox | null {
  const t = clampByte(threshold)
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1
  for (let y = 0; y < a.height; y++) {
    const row = y * a.width
    for (let x = 0; x < a.width; x++) {
      if (a.data[row + x] > t) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export interface AlphaProcessParams {
  alphaThreshold: number
  featherPx: number
}

/**
 * 生マスク → 利用するアルファ。順序: しきい値 → 外接矩形（しきい値後の画素で決定的に）→ 縁ぼかし。
 * 外接矩形はぼかし前の画素で計算する（ぼかしで広がった薄い縁で余白計算が狂わないように）。
 */
export function processAlpha(raw: AlphaMap, p: AlphaProcessParams): { alpha: AlphaMap; bbox: CutoutBBox | null } {
  const thresholded = applyThreshold(raw, p.alphaThreshold)
  const bbox = computeBbox(thresholded, p.alphaThreshold)
  const alpha = featherAlpha(thresholded, p.featherPx)
  return { alpha, bbox }
}

/**
 * 元画像の RGBA にアルファを適用した RGBA を返す。RGB は 1 バイトも変えない（原則2）。
 * 元画像に透明部分があればそれも尊重する（min）。
 */
export function compositeRgba(original: Uint8ClampedArray, alpha: AlphaMap): Uint8ClampedArray {
  const n = alpha.width * alpha.height
  if (original.length !== n * 4) throw new Error('compositeRgba: size mismatch')
  const out = new Uint8ClampedArray(original.length)
  out.set(original)
  for (let i = 0; i < n; i++) {
    const o = i * 4 + 3
    out[o] = Math.min(original[o], alpha.data[i])
  }
  return out
}
