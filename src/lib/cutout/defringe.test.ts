import { describe, it, expect } from 'vitest'
import { compositeDefringed, defringePxOf, defringeRgba, estimateBackground } from './defringe'
import type { AlphaMap } from './alpha'

// 12×12: 背景 (200,40,40)。商品 = (100,100,100) の正方形 x,y ∈ [3,8]。その外側 1 周は半透明（α=128・色は半々の混色）。
// 商品の一番外の 1 周（深さ 1）は背景の反射で少し赤く被っている (110,94,94)
const BG: [number, number, number] = [200, 40, 40], OBJ = [100, 100, 100]
function build() {
  const w = 12, h = 12, rgba = new Uint8ClampedArray(w * h * 4), alpha = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    const inObj = x >= 3 && x <= 8 && y >= 3 && y <= 8
    const ring = !inObj && x >= 2 && x <= 9 && y >= 2 && y <= 9
    const outer = inObj && (x === 3 || x === 8 || y === 3 || y === 8)
    const col = inObj ? (outer ? [110, 94, 94] : OBJ) : ring ? [150, 70, 70] : BG
    rgba.set([col[0], col[1], col[2], 255], i * 4)
    alpha[i] = inObj ? 255 : ring ? 128 : 0
  }
  return { w, h, rgba, alpha: { data: alpha, width: w, height: h } as AlphaMap }
}
const px = (a: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(a.slice((y * w + x) * 4, (y * w + x) * 4 + 4))

describe('縁の色被り除去（2026-11-08 メモ 72）', () => {
  it('背景色は透明な画素の中央値で推定する', () => {
    const { w, h, rgba, alpha } = build()
    const out = compositeDefringed(rgba, alpha, { defringe: false })
    expect(estimateBackground(out, w, h)).toEqual(BG)
  })
  it('半透明の縁は背景色の混ざり分を差し引いて商品の色に戻り、深い内側と透明な背景とアルファは変わらない', () => {
    const { w, rgba, alpha } = build()
    const out = compositeDefringed(rgba, alpha, { defringe: true, defringePx: 1 })
    const ring = px(out, w, 2, 5)                       // 半透明の縁
    expect(ring[3]).toBe(128)
    expect(Math.abs(ring[0] - 100)).toBeLessThanOrEqual(2); expect(Math.abs(ring[1] - 100)).toBeLessThanOrEqual(2); expect(Math.abs(ring[2] - 100)).toBeLessThanOrEqual(2)
    expect(px(out, w, 5, 5)).toEqual([100, 100, 100, 255])   // 深い内側はそのまま
    expect(px(out, w, 0, 0)).toEqual([200, 40, 40, 0])       // 透明な背景の色もそのまま（アルファ 0）
    const edge = px(out, w, 3, 5)                       // 不透明の縁 1 px 目: 赤被りが弱まる
    expect(edge[3]).toBe(255)
    expect(edge[0]).toBeLessThan(110); expect(edge[1]).toBeGreaterThan(94); expect(edge[2]).toBeGreaterThan(94)
    expect(Math.abs(edge[0] - edge[1])).toBeLessThan(16 - 4)  // 元は R−G = 16 → 小さくなる
  })
  it('OFF ならアルファを付けただけで色は 1 バイトも変えない。内側 0 px なら半透明の縁だけ直す', () => {
    const { w, rgba, alpha } = build()
    const off = compositeDefringed(rgba, alpha, { defringe: false })
    expect(px(off, w, 2, 5)).toEqual([150, 70, 70, 128]); expect(px(off, w, 3, 5)).toEqual([110, 94, 94, 255])
    const zero = compositeDefringed(rgba, alpha, { defringe: true, defringePx: 0 })
    expect(px(zero, w, 3, 5)).toEqual([110, 94, 94, 255])
    expect(Math.abs(px(zero, w, 2, 5)[0] - 100)).toBeLessThanOrEqual(2)
  })
  it('設定の既定: 未指定は ON・内側 2 px。範囲外は丸める', () => {
    expect(defringePxOf(undefined)).toBe(2); expect(defringePxOf({ defringePx: 9 })).toBe(3); expect(defringePxOf({ defringePx: -1 })).toBe(0)
    const { w, h, rgba, alpha } = build()
    const base = compositeDefringed(rgba, alpha, { defringe: false })
    expect(defringeRgba(base, w, h, undefined)).not.toEqual(base)        // 未指定 = ON
    const noBg = new Uint8ClampedArray(base); for (let i = 3; i < noBg.length; i += 4) noBg[i] = 255   // 透明な画素が無い → 推定できず何もしない
    expect(defringeRgba(noBg, w, h, { defringe: true })).toEqual(noBg)
  })
})
