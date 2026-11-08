// 縁の色被り除去（デフリンジ・2026-11-08 メモ 72）。
// 切り抜きの縁の半透明画素は、透明度（マスク）が正しくても色は元写真のまま＝商品と背景が混ざった色なので、
// 白などに置くと背景色の縁が出る。背景色の混ざり分を差し引いて商品の色に戻す（F = (C − (1−α)·B) / α）。
// さらに不透明の縁から数 px は、撮影時の背景の反射（色被り）で背景色に寄っていることがあるので、
// 内側の色を基準に背景色方向の成分だけを弱める（縁から離れるほど弱く）。
// 背景色は写真ごとに alpha = 0 の画素の中央値から推定する（無地背景の商品写真が前提）。
// 元画像の RGB を変えるのはこの処理だけで、Remove Background の設定で切れる（既定 ON）。
import { compositeRgba, type AlphaMap } from './alpha'

export interface DefringeSpec { defringe?: boolean; defringePx?: number }
export const DEFAULT_DEFRINGE_PX = 2
export const MAX_DEFRINGE_PX = 3
const INNER_WEIGHT = [1, 0.7, 0.4]   // 不透明の縁 1 px 目・2 px 目・3 px 目の補正の強さ
const MAX_SPILL = 0.9
const OPAQUE = 250                   // これ以上のアルファは不透明として扱う

/** 未指定は ON（保存済みの古い設定にも効く） */
export const defringeEnabled = (s?: DefringeSpec | null): boolean => s?.defringe !== false
export function defringePxOf(s?: DefringeSpec | null): number {
  const v = Number(s?.defringePx)
  return Number.isFinite(v) ? Math.min(MAX_DEFRINGE_PX, Math.max(0, Math.round(v))) : DEFAULT_DEFRINGE_PX
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** 背景色の推定: 透明（alpha = 0）な画素を間引いて集め、チャンネルごとの中央値。透明な画素がほとんど無ければ null */
export function estimateBackground(rgba: Uint8ClampedArray, width: number, height: number): [number, number, number] | null {
  const n = width * height
  const step = Math.max(1, Math.floor(Math.sqrt(n / 20000)))
  const r: number[] = [], g: number[] = [], b: number[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      if (rgba[i + 3] === 0) { r.push(rgba[i]); g.push(rgba[i + 1]); b.push(rgba[i + 2]) }
    }
  }
  if (r.length < 16) return null
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1] }
  return [med(r), med(g), med(b)]
}

/** 3×3 の最小値（不透明領域を 1 px 縮める）。画像の外は不透明とみなす（画像端に接する商品の端を縁にしない） */
function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let keep = 1
      for (let dy = -1; dy <= 1 && keep; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (!mask[yy * w + xx]) { keep = 0; break }
        }
      }
      out[i] = keep
    }
  }
  return out
}

/**
 * アルファ適用済みの RGBA（compositeRgba の出力）の色だけを直す。アルファは変えない。新しい配列を返す。
 * background を渡さなければ推定する。
 */
export function defringeRgba(rgba: Uint8ClampedArray, width: number, height: number, spec?: DefringeSpec | null, background?: [number, number, number] | null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  if (!defringeEnabled(spec)) return out
  const B = background ?? estimateBackground(rgba, width, height)
  if (!B) return out
  const n = width * height

  // 1. 半透明の画素: 背景色の混ざり分を差し引く
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]
    if (a === 0 || a >= OPAQUE) continue
    const af = a / 255
    for (let c = 0; c < 3; c++) out[i * 4 + c] = clamp255((rgba[i * 4 + c] - (1 - af) * B[c]) / af)
  }
  const innerPx = defringePxOf(spec)
  if (innerPx === 0) return out

  // 2. 不透明の縁 1〜innerPx px: 縁からの距離の帯を作る
  const opaque = new Uint8Array(n)
  for (let i = 0; i < n; i++) opaque[i] = rgba[i * 4 + 3] >= OPAQUE ? 1 : 0
  const depth = new Uint8Array(n)
  let cur: Uint8Array = opaque
  for (let d = 1; d <= innerPx; d++) {
    const next = erode(cur, width, height)
    for (let i = 0; i < n; i++) if (cur[i] && !next[i]) depth[i] = d
    cur = next
  }
  const deep = cur

  // 基準色: 深い内側は元の色。帯は、より内側（deep か深さ d+1 の帯）の近傍の基準色の平均（内側から外側へ順に伝える）
  const ref = new Uint8ClampedArray(n * 3)
  const hasRef = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (deep[i]) { ref[i * 3] = rgba[i * 4]; ref[i * 3 + 1] = rgba[i * 4 + 1]; ref[i * 3 + 2] = rgba[i * 4 + 2]; hasRef[i] = 1 }
  for (let d = innerPx; d >= 1; d--) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (depth[i] !== d) continue
        let sr = 0, sg = 0, sb = 0, cnt = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= width) continue
            const j = yy * width + xx
            if (!hasRef[j] || !(deep[j] || depth[j] === d + 1)) continue
            sr += ref[j * 3]; sg += ref[j * 3 + 1]; sb += ref[j * 3 + 2]; cnt++
          }
        }
        if (cnt) { ref[i * 3] = sr / cnt; ref[i * 3 + 1] = sg / cnt; ref[i * 3 + 2] = sb / cnt; hasRef[i] = 1 }
      }
    }
  }

  // 補正: 元の色 C を基準色 F̂ と背景色 B の間で見て、B 側に寄っている分（スピル）だけ戻す
  for (let i = 0; i < n; i++) {
    const d = depth[i]
    if (!d || !hasRef[i]) continue
    const w = INNER_WEIGHT[d - 1] ?? 0.3
    const fr = ref[i * 3], fg = ref[i * 3 + 1], fb = ref[i * 3 + 2]
    const vr = B[0] - fr, vg = B[1] - fg, vb = B[2] - fb
    const vv = vr * vr + vg * vg + vb * vb
    if (vv < 1) continue
    const cr = rgba[i * 4], cg = rgba[i * 4 + 1], cb = rgba[i * 4 + 2]
    let s = ((cr - fr) * vr + (cg - fg) * vg + (cb - fb) * vb) / vv
    s = Math.min(MAX_SPILL, Math.max(0, s)) * w
    if (s <= 0.01) continue
    out[i * 4] = clamp255((cr - s * B[0]) / (1 - s))
    out[i * 4 + 1] = clamp255((cg - s * B[1]) / (1 - s))
    out[i * 4 + 2] = clamp255((cb - s * B[2]) / (1 - s))
  }
  return out
}

/** 元画像 + アルファ → 表示・書き出しに使う RGBA。設定が ON なら縁の色被りを除く（レイアウト合成・透過 PNG・プレビューの共通入口） */
export function compositeDefringed(original: Uint8ClampedArray, alpha: AlphaMap, spec?: DefringeSpec | null): Uint8ClampedArray {
  const rgba = compositeRgba(original, alpha)
  return defringeEnabled(spec) ? defringeRgba(rgba, alpha.width, alpha.height, spec) : rgba
}
