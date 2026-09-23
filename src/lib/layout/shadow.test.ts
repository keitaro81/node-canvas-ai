import { describe, it, expect } from 'vitest'
import { computeLayout, DEFAULT_LAYOUT_PARAMS } from './computeLayout'
import { blurRadiusOf, contactShadowAlpha, dropShadowAlpha, ellipseAlpha } from './shadow'
import type { AlphaMap } from '../cutout/alpha'

const P = { ...DEFAULT_LAYOUT_PARAMS, width: 100, height: 100, marginUnit: 'px' as const, marginTop: 25, marginRight: 25, marginBottom: 25, marginLeft: 25 }
const fullMask = (w: number, h: number): AlphaMap => ({ width: w, height: h, data: new Uint8ClampedArray(w * h).fill(255) })

describe('ellipseAlpha', () => {
  it('楕円の内側は 255、外側（角）は 0', () => {
    const a = ellipseAlpha({ width: 100, height: 100 }, { x: 20, y: 40, width: 60, height: 20 })
    expect(a.data[50 * 100 + 50]).toBe(255)   // 中心
    expect(a.data[40 * 100 + 20]).toBe(0)     // 外接矩形の角は楕円の外
    expect(a.data[0]).toBe(0)
  })
})

describe('dropShadowAlpha', () => {
  it('ぼかし 0 なら、商品の形を (offsetX, offsetY) ずらした位置に濃さを掛けて置く', () => {
    const plan = computeLayout({ params: { ...P, shadowKind: 'drop', shadowBlur: 0, shadowOffsetX: 10, shadowOffsetY: 10, shadowOpacity: 0.5 }, source: { width: 50, height: 50 }, bbox: { x: 0, y: 0, w: 50, h: 50 } })
    expect(plan.scale).toBe(1)
    expect(plan.productRect).toEqual({ x: 25, y: 25, width: 50, height: 50 })
    const a = dropShadowAlpha(fullMask(50, 50), plan)
    expect(a.data[30 * 100 + 30]).toBe(0)       // ずらし前の領域（30,30）は影なし
    expect(a.data[40 * 100 + 40]).toBe(128)     // ずらし後の領域内は 255×0.5
    expect(a.data[84 * 100 + 84]).toBe(128)     // 右下端（25+10+50-1）
    expect(a.data[90 * 100 + 90]).toBe(0)
  })
  it('ぼかしを入れると縁が滑らかになり、最大値は濃さを超えない', () => {
    const plan = computeLayout({ params: { ...P, shadowKind: 'drop', shadowBlur: 8, shadowOffsetX: 0, shadowOffsetY: 0, shadowOpacity: 0.25 }, source: { width: 50, height: 50 }, bbox: { x: 0, y: 0, w: 50, h: 50 } })
    const a = dropShadowAlpha(fullMask(50, 50), plan)
    const max = Math.max(...Array.from(a.data))
    expect(max).toBeLessThanOrEqual(64)
    expect(a.data[50 * 100 + 50]).toBe(64)      // 内部は 255×0.25 ≒ 64
    expect(a.data[50 * 100 + 22]).toBeGreaterThan(0) // 縁の外側に薄く広がる
    expect(a.data[50 * 100 + 10]).toBe(0)
  })
  it('blurRadiusOf は px の半分（ボックス×2 ≒ ガウス）', () => {
    expect(blurRadiusOf(24)).toBe(12); expect(blurRadiusOf(0)).toBe(0)
  })
})

describe('contactShadowAlpha', () => {
  it('外接矩形の下端中央に影があり、商品の上部には無い', () => {
    const plan = computeLayout({ params: { ...P, shadowKind: 'contact', shadowBlur: 0, shadowOpacity: 0.4 }, source: { width: 50, height: 50 }, bbox: { x: 0, y: 0, w: 50, h: 50 } })
    const a = contactShadowAlpha(plan)
    // 楕円中心 = (50, 75)
    expect(a.data[75 * 100 + 50]).toBe(102)     // 255×0.4
    expect(a.data[30 * 100 + 50]).toBe(0)
  })
})
