import { describe, it, expect } from 'vitest'
import {
  alphaFromRgba, alphaFromLuminance, resizeAlpha, applyThreshold, featherAlpha,
  computeBbox, processAlpha, compositeRgba, type AlphaMap,
} from './alpha'

function rgbaOf(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = fill(x, y)
    const o = (y * w + x) * 4
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
  }
  return out
}
function alphaOf(w: number, h: number, fill: (x: number, y: number) => number): AlphaMap {
  const data = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fill(x, y)
  return { width: w, height: h, data }
}

describe('alphaFromRgba / alphaFromLuminance', () => {
  it('透過 PNG からはアルファチャネルだけを取る', () => {
    const rgba = rgbaOf(2, 1, (x) => [10, 20, 30, x === 0 ? 255 : 7])
    expect(Array.from(alphaFromRgba(rgba, 2, 1).data)).toEqual([255, 7])
  })
  it('マスク画像は RGB の平均を輝度としてアルファにする', () => {
    const rgba = rgbaOf(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 30, 60, 255]))
    expect(Array.from(alphaFromLuminance(rgba, 2, 1).data)).toEqual([255, 30])
  })
})

describe('resizeAlpha', () => {
  it('同じ寸法ならそのまま返す', () => {
    const a = alphaOf(3, 2, () => 9)
    expect(resizeAlpha(a, 3, 2)).toBe(a)
  })
  it('拡大は寸法どおりで、一様な平面は一様のまま', () => {
    const a = alphaOf(4, 4, () => 200)
    const r = resizeAlpha(a, 16, 16)
    expect(r.width).toBe(16); expect(r.height).toBe(16); expect(r.data.length).toBe(256)
    expect(Array.from(r.data).every((v) => v === 200)).toBe(true)
  })
  it('拡大時に左右の段差が滑らかに補間され、端の値は保たれる', () => {
    const a = alphaOf(2, 1, (x) => (x === 0 ? 0 : 255))
    const r = resizeAlpha(a, 8, 1)
    const v = Array.from(r.data)
    expect(v[0]).toBe(0); expect(v[7]).toBe(255)
    for (let i = 1; i < 8; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1])
  })
  it('縮小も寸法どおり（Bria の 1024px 出力を元解像度へ、の逆方向も同じ関数）', () => {
    const a = alphaOf(8, 8, (x) => (x < 4 ? 0 : 255))
    const r = resizeAlpha(a, 4, 4)
    expect(r.width).toBe(4)
    expect(r.data[0]).toBe(0); expect(r.data[3]).toBe(255)
  })
})

describe('applyThreshold / computeBbox', () => {
  it('しきい値「以下」を 0 にし、超える値は変えない', () => {
    const a = alphaOf(4, 1, (x) => [0, 8, 9, 255][x])
    expect(Array.from(applyThreshold(a, 8).data)).toEqual([0, 0, 9, 255])
  })
  it('外接矩形はしきい値を「超える」画素の範囲', () => {
    const a = alphaOf(6, 5, (x, y) => (x >= 2 && x <= 4 && y >= 1 && y <= 3 ? 200 : x === 0 ? 8 : 0))
    expect(computeBbox(a, 8)).toEqual({ x: 2, y: 1, w: 3, h: 3 })
  })
  it('全透明なら null', () => {
    expect(computeBbox(alphaOf(3, 3, () => 0), 8)).toBeNull()
  })
})

describe('featherAlpha', () => {
  it('0px は同一オブジェクトを返す（無加工）', () => {
    const a = alphaOf(4, 4, () => 255)
    expect(featherAlpha(a, 0)).toBe(a)
  })
  it('縁が滑らかになり、値は 0〜255 に収まり、内部は不透明のまま', () => {
    const a = alphaOf(20, 1, (x) => (x >= 10 ? 255 : 0))
    const f = featherAlpha(a, 2)
    const v = Array.from(f.data)
    expect(v[0]).toBe(0); expect(v[19]).toBe(255)
    expect(v[9]).toBeGreaterThan(0); expect(v[9]).toBeLessThan(255)
    expect(v[10]).toBeGreaterThan(v[9]); expect(v[11]).toBeGreaterThan(v[10])
    expect(v.every((x) => x >= 0 && x <= 255)).toBe(true)
  })
})

describe('processAlpha', () => {
  it('しきい値→外接矩形→ぼかしの順で、外接矩形はぼかし前の画素で決まる', () => {
    const raw = alphaOf(12, 12, (x, y) => (x >= 4 && x <= 7 && y >= 4 && y <= 7 ? 255 : 5))
    const { alpha, bbox } = processAlpha(raw, { alphaThreshold: 8, featherPx: 2 })
    expect(bbox).toEqual({ x: 4, y: 4, w: 4, h: 4 })
    expect(alpha.data[0]).toBe(0)                 // ノイズ 5 はしきい値で消える
    expect(alpha.data[3 * 12 + 3]).toBeGreaterThan(0) // ぼかしで縁の外側に薄い値が出る
  })
})

describe('compositeRgba（原則2: 商品ピクセル不変）', () => {
  it('RGB は 1 バイトも変わらず、アルファだけがマスクになる', () => {
    const original = rgbaOf(3, 1, (x) => [x * 10 + 1, x * 10 + 2, x * 10 + 3, 255])
    const alpha = alphaOf(3, 1, (x) => [0, 128, 255][x])
    const out = compositeRgba(original, alpha)
    for (let i = 0; i < 3; i++) {
      expect(out[i * 4]).toBe(original[i * 4])
      expect(out[i * 4 + 1]).toBe(original[i * 4 + 1])
      expect(out[i * 4 + 2]).toBe(original[i * 4 + 2])
    }
    expect([out[3], out[7], out[11]]).toEqual([0, 128, 255])
  })
  it('元画像に透明部分があれば min で尊重する', () => {
    const original = rgbaOf(2, 1, (x) => [1, 2, 3, x === 0 ? 50 : 255])
    const alpha = alphaOf(2, 1, () => 200)
    const out = compositeRgba(original, alpha)
    expect([out[3], out[7]]).toEqual([50, 200])
  })
  it('寸法が合わなければ例外', () => {
    expect(() => compositeRgba(new Uint8ClampedArray(8), alphaOf(3, 1, () => 0))).toThrow()
  })
})
