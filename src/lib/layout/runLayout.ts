// レイアウトの実行フロー（ブラウザ）: 素材の用意 → 計算 → 描画 → 保存。
// 対話実行（ProductLayoutNode）と、将来の一括実行（ReviewGrid の書き出し）で共用する。
import type { CutoutRef, LayoutOutputRef, LayoutParams } from '../../types/nodes'
import type { AlphaMap } from '../cutout/alpha'
import { decodeBlob, fetchBlob, type DecodedImage } from '../cutout/decode'
import { loadRawAlpha } from '../cutout/runCutout'
import { signBatchPath, uploadBatchObject } from '../cutout/store'
import { computeLayout, type LayoutPlan } from './computeLayout'
import { layoutHash } from './identity'
import { renderLayoutToPng } from './renderLayout'

export interface LayoutAssets {
  original: DecodedImage
  rawAlpha: AlphaMap
  background: ImageBitmap | null
}

/** 元画像（署名 URL）・生マスク・背景画像を読み込む。呼び出し側でキャッシュしてよい。 */
export async function loadLayoutAssets(input: { originalUrl: string; cutout: CutoutRef; backgroundUrl?: string | null }): Promise<LayoutAssets> {
  const maskUrl = await signBatchPath(input.cutout.maskPath)
  if (!maskUrl) throw new Error('マスクを取得できません（チームの権限を確認してください）')
  const [original, rawAlpha, background] = await Promise.all([
    decodeBlob(await fetchBlob(input.originalUrl)),
    loadRawAlpha(maskUrl, input.cutout.width, input.cutout.height),
    input.backgroundUrl
      ? fetchBlob(input.backgroundUrl).then((b) => createImageBitmap(b, { colorSpaceConversion: 'default' }))
      : Promise.resolve(null),
  ])
  if (original.width !== input.cutout.width || original.height !== input.cutout.height) {
    throw new Error('元画像の寸法が切り抜き時と異なります。切り抜きを再実行してください')
  }
  return { original, rawAlpha, background }
}

export interface RunLayoutInput {
  params: LayoutParams
  cutout: CutoutRef
  assets: LayoutAssets
  backgroundRef?: string | null
}

export interface RunLayoutResult {
  plan: LayoutPlan
  hash: string
  blob: Blob
}

/** 計算 → 描画。保存はしない（プレビューにも使う）。 */
export async function runLayout(input: RunLayoutInput): Promise<RunLayoutResult> {
  const { params, cutout, assets } = input
  const plan = computeLayout({
    params,
    source: { width: cutout.width, height: cutout.height },
    bbox: cutout.bbox,
    background: assets.background ? { width: assets.background.width, height: assets.background.height } : null,
  })
  const hash = await layoutHash({
    params, sourceRef: cutout.sourceRef, maskPath: cutout.maskPath,
    alphaThreshold: cutout.params.alphaThreshold, featherPx: cutout.params.featherPx, backgroundRef: input.backgroundRef ?? null,
  })
  const blob = await renderLayoutToPng({
    plan, original: assets.original, rawAlpha: assets.rawAlpha,
    cutout: { alphaThreshold: cutout.params.alphaThreshold, featherPx: cutout.params.featherPx },
    background: assets.background,
  })
  return { plan, hash, blob }
}

/** 出力 PNG を batch バケットに保存する（同じ識別値のファイルが既にあれば再アップロードしない）。 */
export async function storeLayoutOutput(input: { dir: string; result: RunLayoutResult; cutout: CutoutRef }): Promise<LayoutOutputRef> {
  const { dir, result, cutout } = input
  const path = `${dir}/${result.hash}.png`
  try {
    await uploadBatchObject(path, result.blob)
  } catch (e) {
    // 同じ識別値 = 同じ内容。既に存在するなら成功扱い（仕様 4-10「同じ内容の出力は作り直さない」）
    const msg = e instanceof Error ? e.message : String(e)
    if (!/already exists|duplicate|409/i.test(msg)) throw e
  }
  return {
    path,
    width: result.plan.canvas.width,
    height: result.plan.canvas.height,
    layoutHash: result.hash,
    warnings: result.plan.warnings,
    sourceRef: cutout.sourceRef,
    maskPath: cutout.maskPath,
    createdAt: new Date().toISOString(),
  }
}
