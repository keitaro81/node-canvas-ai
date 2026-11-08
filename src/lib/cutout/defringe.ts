// 縁の色被り除去（デフリンジ・2026-11-08 メモ 72）。
// 切り抜きの縁の半透明画素は、透明度（マスク）が正しくても色は元写真のまま＝商品と背景が混ざった色なので、
// 白などに置くと背景色の縁が出る。背景色の混ざり分を差し引いて商品の色に戻す（F = (C − (1−α)·B) / α）。
// さらに不透明の縁から数 px は、撮影時の背景の反射（色被り）で背景色に寄っていることがあるので、
// 内側の色を基準に背景色方向の成分だけを弱める（縁から離れるほど弱く）。
// 背景色は写真ごとに alpha = 0 の画素の中央値から推定する（無地背景の商品写真が前提）。
// 差し引くのは「その画素の色が内側の色と背景色の間に乗っている」ときだけ（影や布どうしの境目の半透明画素まで差し引くと、背景色の補色のノイズが出る・2026-11-08 ユーザー報告）。
// 元画像の RGB を変えるのはこの処理だけで、Remove Background の設定で切れる（既定 ON）。
import { compositeRgba, type AlphaMap } from './alpha'

export interface DefringeSpec { defringe?: boolean; defringePx?: number }
export const DEFAULT_DEFRINGE_PX = 2
export const MAX_DEFRINGE_PX = 3
const INNER_WEIGHT = [1, 0.7, 0.4]   // 不透明の縁 1 px 目・2 px 目・3 px 目の補正の強さ
const MAX_SPILL = 0.8                // 差し引く背景色の上限（これ以上は残りを 5 倍以上に拡大することになり、ノイズが目立つ）
const LOW_ALPHA = 0.35               // これより透明な画素は、結果を基準色（内側の色）に寄せる
const PARTIAL_REF_MAX_RINGS = 16     // 半透明画素へ基準色を伝える最大の距離（px）
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
  const innerPx = defringePxOf(spec)
  const refPx = Math.max(1, innerPx)   // 基準色は少なくとも 1 px 内側の色から取る（一番外の不透明画素は背景色に寄っていることが多い）

  // 不透明の縁 1〜refPx px: 縁からの距離の帯を作る（内側の補正が 0 でも、基準色のために 1 px は縮める）
  const opaque = new Uint8Array(n)
  for (let i = 0; i < n; i++) opaque[i] = rgba[i * 4 + 3] >= OPAQUE ? 1 : 0
  const depth = new Uint8Array(n)
  let cur: Uint8Array = opaque
  for (let d = 1; d <= refPx; d++) {
    const next = erode(cur, width, height)
    for (let i = 0; i < n; i++) if (cur[i] && !next[i]) depth[i] = d
    cur = next
  }
  const deep = cur

  // 基準色: 深い内側は元の色。帯は、より内側（deep か深さ d+1 の帯）の近傍の基準色の平均（内側から外側へ順に伝える）
  const ref = new Uint8ClampedArray(n * 3)
  const hasRef = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (deep[i]) { ref[i * 3] = rgba[i * 4]; ref[i * 3 + 1] = rgba[i * 4 + 1]; ref[i * 3 + 2] = rgba[i * 4 + 2]; hasRef[i] = 1 }
  for (let d = refPx; d >= 1; d--) {
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

  // 半透明画素の基準色: 不透明領域に接する画素から外へ、幅優先で順に伝える（遠すぎる画素＝不透明領域から PARTIAL_REF_MAX_RINGS px 超は基準色なし）
  const isPartial = (j: number) => { const a = rgba[j * 4 + 3]; return a !== 0 && a < OPAQUE }
  const refFromNeighbors = (x: number, y: number, allow: (j: number) => boolean): boolean => {
    const i = y * width + x
    let sr = 0, sg = 0, sb = 0, cnt = 0
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= height) continue
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= width) continue
        const j = yy * width + xx
        if (!hasRef[j] || !allow(j)) continue
        sr += ref[j * 3]; sg += ref[j * 3 + 1]; sb += ref[j * 3 + 2]; cnt++
      }
    }
    if (!cnt) return false
    ref[i * 3] = sr / cnt; ref[i * 3 + 1] = sg / cnt; ref[i * 3 + 2] = sb / cnt; hasRef[i] = 1
    return true
  }
  const ringOf = new Uint8Array(n)   // 何周目で基準色が付いたか（0 = 不透明か未）
  let frontier: number[] = []
  // 1 周目: 不透明な画素に接する半透明画素
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!isPartial(i)) continue
      if (refFromNeighbors(x, y, (j) => opaque[j] === 1)) { ringOf[i] = 1; frontier.push(i) }
    }
  }
  for (let k = 2; k <= PARTIAL_REF_MAX_RINGS && frontier.length; k++) {
    const next: number[] = []
    for (const i of frontier) {
      const x = i % width, y = (i - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const j = yy * width + xx
          if (hasRef[j] || !isPartial(j)) continue
          if (refFromNeighbors(xx, yy, (m) => opaque[m] === 1 || (ringOf[m] > 0 && ringOf[m] < k))) { ringOf[j] = k; next.push(j) }
        }
      }
    }
    frontier = next
  }

  /**
   * 色 C が「基準色 F̂ と背景色 B を結ぶ線の上」にどれだけ乗っているか。
   * s = 線上の位置（0 = F̂・1 = B）、fit = 線からの外れ具合で決める重み（0〜1）。影や布どうしの境目（線から外れる）は補正しない
   */
  const mixOf = (cr: number, cg: number, cb: number, fr: number, fg: number, fb: number): { s: number; w: number } => {
    const vr = B[0] - fr, vg = B[1] - fg, vb = B[2] - fb
    const vv = vr * vr + vg * vg + vb * vb
    if (vv < 1) return { s: 0, w: 0 }
    const dr = cr - fr, dg = cg - fg, db = cb - fb
    const s = Math.max(0, Math.min(1, (dr * vr + dg * vg + db * vb) / vv))
    const er = dr - s * vr, eg = dg - s * vg, eb = db - s * vb
    const off = Math.sqrt(er * er + eg * eg + eb * eb)        // 線からの外れ
    const along = s * Math.sqrt(vv)                            // 線に沿った量
    const fit = off / (along + 12)
    const w = fit >= 1 ? 0 : fit <= 0.5 ? 1 : (1 - fit) * 2
    return { s, w }
  }

  // 1. 半透明の画素: 背景色の混ざり分を差し引く。「混ざっている量」は色から見積もり（基準色との比較）、透明度から分かる量と上限で抑える。
  //    基準色が無い（不透明領域から遠い）画素は触らない。透明度が低い画素は結果を基準色に寄せる（元の色がほぼ背景色で、差し引くとノイズだけが残るため）
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]
    if (a === 0 || a >= OPAQUE || !hasRef[i]) continue
    const af = a / 255
    const cr = rgba[i * 4], cg = rgba[i * 4 + 1], cb = rgba[i * 4 + 2]
    const fr = ref[i * 3], fg = ref[i * 3 + 1], fb = ref[i * 3 + 2]
    const m = mixOf(cr, cg, cb, fr, fg, fb)
    const s = Math.min(MAX_SPILL, 1 - af, m.s) * m.w
    if (s <= 0.01) continue
    const k = Math.min(1, af / LOW_ALPHA)
    const ur = (cr - s * B[0]) / (1 - s), ug = (cg - s * B[1]) / (1 - s), ub = (cb - s * B[2]) / (1 - s)
    out[i * 4] = clamp255(fr + (ur - fr) * k)
    out[i * 4 + 1] = clamp255(fg + (ug - fg) * k)
    out[i * 4 + 2] = clamp255(fb + (ub - fb) * k)
  }

  // 2. 不透明の縁の帯: 元の色 C を基準色 F̂ と背景色 B の間で見て、B 側に寄っている分（スピル）だけ戻す。線から外れる画素（影・境目）は触らない
  for (let i = 0; i < n; i++) {
    const d = depth[i]
    if (!d || d > innerPx || !hasRef[i]) continue   // 内側の補正は設定の px まで
    const w = INNER_WEIGHT[d - 1] ?? 0.3
    const cr = rgba[i * 4], cg = rgba[i * 4 + 1], cb = rgba[i * 4 + 2]
    const m = mixOf(cr, cg, cb, ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2])
    const s = Math.min(MAX_SPILL, m.s) * m.w * w
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
