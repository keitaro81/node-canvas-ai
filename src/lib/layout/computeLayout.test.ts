import { describe, it, expect } from 'vitest'
import { computeLayout, contentRectOf, fitBackground, normalizeLayoutParams, DEFAULT_LAYOUT_PARAMS } from './computeLayout'

const P = DEFAULT_LAYOUT_PARAMS

describe('normalizeLayoutParams', () => {
  it('未保存/不正値は既定値で補い、範囲内に丸める', () => {
    expect(normalizeLayoutParams(undefined)).toEqual(P)
    const p = normalizeLayoutParams({ width: 99999, marginTop: -5, marginUnit: 'percent', marginLeft: 90, backgroundColor: 'red', alignH: 'x', shadowOpacity: 3 })
    expect(p.width).toBe(8192); expect(p.marginTop).toBe(0); expect(p.marginLeft).toBe(49)
    expect(p.backgroundColor).toBe('#FFFFFF'); expect(p.alignH).toBe('center'); expect(p.shadowOpacity).toBe(1)
    expect(normalizeLayoutParams({ backgroundColor: '#abcdef' }).backgroundColor).toBe('#ABCDEF')
  })
})

describe('contentRectOf（余白）', () => {
  it('% は幅/高さに対する割合、px はそのまま', () => {
    expect(contentRectOf(P).rect).toEqual({ x: 96, y: 96, width: 1008, height: 1008 })
    expect(contentRectOf({ ...P, marginUnit: 'px', marginTop: 10, marginRight: 20, marginBottom: 30, marginLeft: 40 }).rect).toEqual({ x: 40, y: 10, width: 1140, height: 1160 })
    expect(contentRectOf({ ...P, width: 1080, height: 1920 }).rect).toEqual({ x: 86, y: 154, width: 908, height: 1612 })
  })
  it('余白が大きすぎても領域は最低 1px 残り、警告が出る', () => {
    const r = contentRectOf({ ...P, marginUnit: 'px', marginLeft: 900, marginRight: 900 })
    expect(r.rect.width).toBeGreaterThanOrEqual(1)
    expect(r.warnings.length).toBe(1)
  })
})

describe('computeLayout', () => {
  const source = { width: 750, height: 1125 }
  const bbox = { x: 100, y: 50, w: 500, h: 900 }

  it('拡大が必要なら 100% で整数配置し、警告を含める（縮小なし＝画素一致の前提）', () => {
    const plan = computeLayout({ params: P, source, bbox })
    expect(plan.scale).toBe(1)
    expect(plan.bboxRect).toEqual({ x: 350, y: 150, width: 500, height: 900 })
    expect(plan.productRect).toEqual({ x: 250, y: 100, width: 750, height: 1125 })
    expect(plan.warnings.some((w) => w.includes('100%'))).toBe(true)
    expect(Number.isInteger(plan.productRect.x) && Number.isInteger(plan.productRect.y)).toBe(true)
  })

  it('余白を引いた領域に外接矩形が収まる最大倍率で縮小する', () => {
    const plan = computeLayout({ params: P, source: { width: 4000, height: 4000 }, bbox: { x: 0, y: 0, w: 4000, h: 3000 } })
    expect(plan.scale).toBeCloseTo(0.252, 6)
    expect(plan.bboxRect.width).toBeCloseTo(1008, 6)
    expect(plan.bboxRect.height).toBeCloseTo(756, 6)
    expect(plan.bboxRect.x).toBeCloseTo(96, 6)
    expect(plan.bboxRect.y).toBeCloseTo(96 + (1008 - 756) / 2, 6)
    expect(plan.warnings).toEqual([])
  })

  it('配置: 左上 / 右下 / 中央', () => {
    const src = { width: 4000, height: 4000 }, bb = { x: 0, y: 0, w: 4000, h: 3000 }
    const tl = computeLayout({ params: { ...P, alignH: 'left', alignV: 'top' }, source: src, bbox: bb })
    expect(tl.bboxRect.x).toBe(96); expect(tl.bboxRect.y).toBe(96)
    const br = computeLayout({ params: { ...P, alignH: 'right', alignV: 'bottom' }, source: src, bbox: bb })
    expect(br.bboxRect.x + br.bboxRect.width).toBeCloseTo(96 + 1008, 6)
    expect(br.bboxRect.y + br.bboxRect.height).toBeCloseTo(96 + 1008, 6)
  })

  it('外接矩形が無ければ画像全体を商品として配置し、警告する', () => {
    const plan = computeLayout({ params: P, source, bbox: null })
    expect(plan.bbox).toEqual({ x: 0, y: 0, w: 750, h: 1125 })
    expect(plan.warnings.some((w) => w.includes('検出'))).toBe(true)
  })

  it('背景: 単色 / 透過 / 画像（覆う・収める）/ 画像未接続は単色＋警告', () => {
    expect(computeLayout({ params: P, source, bbox }).background).toEqual({ kind: 'color', color: '#FFFFFF' })
    expect(computeLayout({ params: { ...P, backgroundKind: 'transparent' }, source, bbox }).background).toEqual({ kind: 'transparent' })
    const cover = computeLayout({ params: { ...P, backgroundKind: 'image', backgroundFit: 'cover' }, source, bbox, background: { width: 2000, height: 1000 } }).background
    expect(cover).toEqual({ kind: 'image', fit: 'cover', destRect: { x: -600, y: 0, width: 2400, height: 1200 } })
    const contain = computeLayout({ params: { ...P, backgroundKind: 'image', backgroundFit: 'contain' }, source, bbox, background: { width: 2000, height: 1000 } }).background
    expect(contain).toEqual({ kind: 'image', fit: 'contain', destRect: { x: 0, y: 300, width: 1200, height: 600 } })
    const missing = computeLayout({ params: { ...P, backgroundKind: 'image' }, source, bbox, background: null })
    expect(missing.background).toEqual({ kind: 'color', color: '#FFFFFF' })
    expect(missing.warnings.some((w) => w.includes('背景画像'))).toBe(true)
  })

  it('影: なし / ドロップ / 接地（外接矩形の下端に 0.8 倍幅・0.06 倍高さの楕円）', () => {
    expect(computeLayout({ params: P, source, bbox }).shadow).toBeNull()
    const drop = computeLayout({ params: { ...P, shadowKind: 'drop' }, source, bbox }).shadow
    expect(drop).toEqual({ kind: 'drop', opacity: 0.25, blur: 24, offsetX: 0, offsetY: 12 })
    const contact = computeLayout({ params: { ...P, shadowKind: 'contact' }, source, bbox }).shadow
    expect(contact?.kind).toBe('contact')
    if (contact?.kind === 'contact') {
      expect(contact.ellipse.width).toBeCloseTo(500 * 0.8, 6)
      expect(contact.ellipse.height).toBeCloseTo(900 * 0.06, 6)
      expect(contact.ellipse.x + contact.ellipse.width / 2).toBeCloseTo(350 + 250, 6)   // 水平中央
      expect(contact.ellipse.y + contact.ellipse.height / 2).toBeCloseTo(150 + 900, 6)  // 下端
    }
  })

  it('同じ入力なら必ず同じ結果（決定的）', () => {
    const a = computeLayout({ params: { ...P, shadowKind: 'contact', backgroundKind: 'image' }, source, bbox, background: { width: 3000, height: 2000 } })
    const b = computeLayout({ params: { ...P, shadowKind: 'contact', backgroundKind: 'image' }, source, bbox, background: { width: 3000, height: 2000 } })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('fitBackground: cover は大きい方の倍率、contain は小さい方', () => {
    expect(fitBackground({ width: 1000, height: 1000 }, { width: 500, height: 250 }, 'cover')).toEqual({ x: -500, y: 0, width: 2000, height: 1000 })
    expect(fitBackground({ width: 1000, height: 1000 }, { width: 500, height: 250 }, 'contain')).toEqual({ x: 0, y: 250, width: 1000, height: 500 })
  })
})
