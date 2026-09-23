// レイアウト計算（仕様 3-3「構造の要件」）。ブラウザ固有の機能に一切依存しない純関数。
// 入力: パラメータ・元画像サイズ・外接矩形・背景サイズ → 出力: 配置・倍率・影・背景の配置・警告。
// 同じ入力なら必ず同じ結果（サーバー側レイアウトへの移行時にそのまま使う。仕様 4-10）。
import type { CutoutBBox, LayoutParams } from '../../types/nodes'

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

export interface LayoutInput {
  params: LayoutParams
  source: Size                     // 元画像のサイズ
  bbox: CutoutBBox | null          // 商品の外接矩形（元画像座標）。null なら画像全体を商品とみなす
  background?: Size | null         // 背景画像のサイズ（backgroundKind='image' のとき）
}

export type BackgroundPlan =
  | { kind: 'color'; color: string }
  | { kind: 'transparent' }
  | { kind: 'image'; fit: 'cover' | 'contain'; destRect: Rect }

export type ShadowPlan =
  | null
  | { kind: 'drop'; opacity: number; blur: number; offsetX: number; offsetY: number }
  | { kind: 'contact'; opacity: number; blur: number; ellipse: Rect }

export interface LayoutPlan {
  canvas: Size
  contentRect: Rect                // 余白を引いた領域（整数 px）
  bbox: CutoutBBox                 // 使った外接矩形（元画像座標）
  scale: number                    // 商品の倍率（≤ maxScalePercent/100）
  fitScale: number                 // 領域いっぱいに置くのに必要な倍率（scale < fitScale なら上限で止まっている）
  productRect: Rect                // 元画像全体の配置矩形（出力 px）
  bboxRect: Rect                   // 外接矩形の配置矩形（出力 px）
  background: BackgroundPlan
  shadow: ShadowPlan
  warnings: string[]
}

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  variantName: 'ec_white',
  width: 1200,
  height: 1200,
  maxScalePercent: 100,
  marginUnit: 'percent',
  marginTop: 8,
  marginRight: 8,
  marginBottom: 8,
  marginLeft: 8,
  alignH: 'center',
  alignV: 'center',
  backgroundKind: 'color',
  backgroundColor: '#FFFFFF',
  backgroundFit: 'cover',
  shadowKind: 'none',
  shadowOpacity: 0.25,
  shadowBlur: 24,
  shadowOffsetX: 0,
  shadowOffsetY: 12,
  contactWidthRatio: 0.8,
  contactHeightRatio: 0.06,
}

export const LAYOUT_SIZE_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: 'EC 1200×1200', width: 1200, height: 1200 },
  { label: 'SNS 1080×1350', width: 1080, height: 1350 },
  { label: 'ストーリー 1080×1920', width: 1080, height: 1920 },
]

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback
const HEX = /^#[0-9a-fA-F]{6}$/

/** 保存値（不完全・旧形式かもしれない）を既定値で補い、範囲内に丸める。 */
export function normalizeLayoutParams(p: unknown): LayoutParams {
  const s = (p && typeof p === 'object' ? p : {}) as Partial<Record<keyof LayoutParams, unknown>>
  const d = DEFAULT_LAYOUT_PARAMS
  const marginUnit = oneOf(s.marginUnit, ['percent', 'px'] as const, d.marginUnit)
  const mMax = marginUnit === 'percent' ? 49 : 10000
  return {
    variantName: typeof s.variantName === 'string' && s.variantName.trim() ? s.variantName.trim() : d.variantName,
    width: Math.round(num(s.width, d.width, 16, 8192)),
    height: Math.round(num(s.height, d.height, 16, 8192)),
    maxScalePercent: Math.round(num(s.maxScalePercent, d.maxScalePercent, 100, 400)),
    marginUnit,
    marginTop: num(s.marginTop, d.marginTop, 0, mMax),
    marginRight: num(s.marginRight, d.marginRight, 0, mMax),
    marginBottom: num(s.marginBottom, d.marginBottom, 0, mMax),
    marginLeft: num(s.marginLeft, d.marginLeft, 0, mMax),
    alignH: oneOf(s.alignH, ['left', 'center', 'right'] as const, d.alignH),
    alignV: oneOf(s.alignV, ['top', 'center', 'bottom'] as const, d.alignV),
    backgroundKind: oneOf(s.backgroundKind, ['color', 'image', 'transparent'] as const, d.backgroundKind),
    backgroundColor: typeof s.backgroundColor === 'string' && HEX.test(s.backgroundColor) ? s.backgroundColor.toUpperCase() : d.backgroundColor,
    backgroundFit: oneOf(s.backgroundFit, ['cover', 'contain'] as const, d.backgroundFit),
    shadowKind: oneOf(s.shadowKind, ['none', 'drop', 'contact'] as const, d.shadowKind),
    shadowOpacity: num(s.shadowOpacity, d.shadowOpacity, 0, 1),
    shadowBlur: num(s.shadowBlur, d.shadowBlur, 0, 500),
    shadowOffsetX: num(s.shadowOffsetX, d.shadowOffsetX, -2000, 2000),
    shadowOffsetY: num(s.shadowOffsetY, d.shadowOffsetY, -2000, 2000),
    contactWidthRatio: num(s.contactWidthRatio, d.contactWidthRatio, 0, 5),
    contactHeightRatio: num(s.contactHeightRatio, d.contactHeightRatio, 0, 5),
  }
}

/** 余白（% は幅/高さに対する割合）を px に変換し、余白を引いた領域を返す。領域が潰れる場合は最低 1px を残す。 */
export function contentRectOf(params: LayoutParams): { rect: Rect; warnings: string[] } {
  const warnings: string[] = []
  const toPx = (v: number, base: number) => (params.marginUnit === 'percent' ? (v / 100) * base : v)
  let left = Math.round(toPx(params.marginLeft, params.width))
  let right = Math.round(toPx(params.marginRight, params.width))
  let top = Math.round(toPx(params.marginTop, params.height))
  let bottom = Math.round(toPx(params.marginBottom, params.height))
  if (left + right >= params.width) {
    warnings.push('左右の余白が出力幅以上のため余白を縮めました')
    const total = Math.max(0, params.width - 1)
    const l = left + right > 0 ? left / (left + right) : 0.5
    left = Math.floor(total * l); right = total - left
  }
  if (top + bottom >= params.height) {
    warnings.push('上下の余白が出力高さ以上のため余白を縮めました')
    const total = Math.max(0, params.height - 1)
    const t = top + bottom > 0 ? top / (top + bottom) : 0.5
    top = Math.floor(total * t); bottom = total - top
  }
  return { rect: { x: left, y: top, width: params.width - left - right, height: params.height - top - bottom }, warnings }
}

function placeAlong(pos: number, size: number, avail: number, align: 'left' | 'center' | 'right' | 'top' | 'bottom'): number {
  if (align === 'left' || align === 'top') return pos
  if (align === 'right' || align === 'bottom') return pos + avail - size
  return pos + (avail - size) / 2
}

/** 背景画像の配置（全面を覆う / 全体を収める）。中央合わせ。 */
export function fitBackground(canvas: Size, bg: Size, fit: 'cover' | 'contain'): Rect {
  const sx = canvas.width / bg.width
  const sy = canvas.height / bg.height
  const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)
  const width = bg.width * s
  const height = bg.height * s
  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height }
}

/**
 * レイアウトを決める。
 * - 余白を引いた領域に、外接矩形が収まる最大の倍率で配置（拡大は maxScalePercent まで。既定 100% = 拡大しない。超える場合は上限で止めて警告）
 * - 倍率 1.0 のときは配置座標を整数に丸め、再サンプリングなしで画素をそのまま写せるようにする（7 章の画素一致）
 * - 影はマスクから決定的に作るための寸法だけをここで決める（描画は renderLayout）
 */
export function computeLayout(input: LayoutInput): LayoutPlan {
  const params = normalizeLayoutParams(input.params)
  const warnings: string[] = []
  const canvas: Size = { width: params.width, height: params.height }
  const { rect: contentRect, warnings: mw } = contentRectOf(params)
  warnings.push(...mw)

  const source = input.source
  let bbox: CutoutBBox
  if (input.bbox && input.bbox.w > 0 && input.bbox.h > 0) {
    bbox = input.bbox
  } else {
    bbox = { x: 0, y: 0, w: source.width, h: source.height }
    warnings.push('商品を検出できなかったため画像全体を配置しました')
  }

  const fitScale = Math.min(contentRect.width / bbox.w, contentRect.height / bbox.h)
  const maxScale = params.maxScalePercent / 100
  let scale = fitScale
  if (fitScale > maxScale) {
    scale = maxScale
    warnings.push(`拡大が必要（${Math.round(fitScale * 100)}%）ですが、上限 ${params.maxScalePercent}% で配置しました`)
  }

  let bw = bbox.w * scale
  let bh = bbox.h * scale
  let bx = placeAlong(contentRect.x, bw, contentRect.width, params.alignH)
  let by = placeAlong(contentRect.y, bh, contentRect.height, params.alignV)
  if (scale === 1) {
    // 整数配置＝画素をそのまま写す（再サンプリングしない）
    bx = Math.round(bx); by = Math.round(by); bw = bbox.w; bh = bbox.h
  }
  const bboxRect: Rect = { x: bx, y: by, width: bw, height: bh }
  const productRect: Rect = {
    x: bx - bbox.x * scale,
    y: by - bbox.y * scale,
    width: source.width * scale,
    height: source.height * scale,
  }

  let background: BackgroundPlan
  if (params.backgroundKind === 'transparent') {
    background = { kind: 'transparent' }
  } else if (params.backgroundKind === 'image') {
    if (input.background && input.background.width > 0 && input.background.height > 0) {
      background = { kind: 'image', fit: params.backgroundFit, destRect: fitBackground(canvas, input.background, params.backgroundFit) }
    } else {
      background = { kind: 'color', color: params.backgroundColor }
      warnings.push('背景画像が接続されていないため単色で塗りました')
    }
  } else {
    background = { kind: 'color', color: params.backgroundColor }
  }

  let shadow: ShadowPlan = null
  if (params.shadowKind === 'drop') {
    shadow = { kind: 'drop', opacity: params.shadowOpacity, blur: params.shadowBlur, offsetX: params.shadowOffsetX, offsetY: params.shadowOffsetY }
  } else if (params.shadowKind === 'contact') {
    const ew = bboxRect.width * params.contactWidthRatio
    const eh = bboxRect.height * params.contactHeightRatio
    shadow = {
      kind: 'contact', opacity: params.shadowOpacity, blur: params.shadowBlur,
      ellipse: { x: bboxRect.x + (bboxRect.width - ew) / 2, y: bboxRect.y + bboxRect.height - eh / 2, width: ew, height: eh },
    }
  }

  return { canvas, contentRect, bbox, scale, fitScale, productRect, bboxRect, background, shadow, warnings }
}

/** 実際に見える余白（出力 px と %）。拡大の上限で止まった場合は設定値より広くなる。表示用。 */
export function effectiveMargins(plan: LayoutPlan): { top: number; right: number; bottom: number; left: number; topPct: number; rightPct: number; bottomPct: number; leftPct: number } {
  const { width: W, height: H } = plan.canvas
  const b = plan.bboxRect
  const top = b.y, left = b.x, right = W - (b.x + b.width), bottom = H - (b.y + b.height)
  const pct = (v: number, base: number) => Math.round((v / base) * 1000) / 10
  return { top, right, bottom, left, topPct: pct(top, H), rightPct: pct(right, W), bottomPct: pct(bottom, H), leftPct: pct(left, W) }
}
