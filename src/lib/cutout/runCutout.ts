// 切り抜きの実行フロー（ブラウザ）。
// - runCutoutInteractive: 対話実行（fal を呼び、完了まで待つ）
// - buildCutoutFromEngineResult: 「fal の結果から切り抜きを構成する処理」。対話実行と一括実行（ReviewGrid）の両方から使う共通処理
// - reapplyCutoutParams: 保存済みの生マスクにしきい値/ぼかしを再適用（fal は呼ばない）
import { fal } from '../ai/fal-client'
import type { CutoutEngine, CutoutParams, CutoutRef } from '../../types/nodes'
import { alphaFromLuminance, alphaFromRgba, processAlpha, resizeAlpha, type AlphaMap } from './alpha'
import { decodeBlob, decodeMaskPng, encodeGrayPng, fetchBlob, renderTransparentPng, type DecodedImage } from './decode'
import { buildEngineRequest, CUTOUT_ENGINES, pickEngineResult, type EngineResultFile } from './engines'
import { uploadBatchObject } from './store'

/** ノード上のプレビュー（長辺 px。仕様 4-9「一覧にはサムネイル(長辺400px程度)だけ」） */
export const PREVIEW_MAX_EDGE = 400

export interface CutoutBuildResult {
  ref: CutoutRef
  rawAlpha: AlphaMap       // 元解像度の生マスク（セッション中の再適用/ダウンロード用）
  original: DecodedImage   // 元画像（同上）
}

export interface BuildCutoutInput {
  engine: CutoutEngine
  original: DecodedImage
  resultFile: EngineResultFile
  params: CutoutParams
  dir: string              // 保存先ディレクトリ（batch バケット内 <team_id>/...）
  sourceRef: string
  onProgress?: (message: string) => void
}

/**
 * fal の結果 → アルファ抽出 → 元解像度へ合わせ込み → 生マスク保存 → しきい値/ぼかし/外接矩形 → プレビュー保存。
 * 元画像の RGB には触れない（原則2）。
 */
export async function buildCutoutFromEngineResult(input: BuildCutoutInput): Promise<CutoutBuildResult> {
  const { engine, original, resultFile, params, dir, sourceRef, onProgress } = input
  onProgress?.('結果を取得中…')
  const result = await decodeBlob(await fetchBlob(resultFile.url))
  const alphaAtResult = resultFile.kind === 'mask'
    ? alphaFromLuminance(result.rgba, result.width, result.height)
    : alphaFromRgba(result.rgba, result.width, result.height)
  const rawAlpha = resizeAlpha(alphaAtResult, original.width, original.height)

  onProgress?.('マスクを保存中…')
  const ts = Date.now()
  const maskPath = `${dir}/${ts}-mask.png`
  const previewPath = `${dir}/${ts}-preview.png`
  const { alpha, bbox } = processAlpha(rawAlpha, params)
  const [maskBlob, previewBlob] = await Promise.all([
    encodeGrayPng(rawAlpha),
    renderTransparentPng(original, alpha, PREVIEW_MAX_EDGE),
  ])
  await Promise.all([uploadBatchObject(maskPath, maskBlob), uploadBatchObject(previewPath, previewBlob)])

  const ref: CutoutRef = {
    sourceRef,
    width: original.width,
    height: original.height,
    maskPath,
    previewPath,
    bbox,
    engine,
    params: { ...params },
    createdAt: new Date().toISOString(),
  }
  return { ref, rawAlpha, original }
}

export interface RunCutoutInput {
  dir: string
  imageUrl: string         // fal から到達できる URL（署名 URL）
  sourceRef: string        // 元画像の canonical 参照
  params: CutoutParams
  onProgress?: (message: string) => void
}

/** 対話実行: 元画像を読み込み → fal（proxy 経由）→ 共通処理。 */
export async function runCutoutInteractive(input: RunCutoutInput): Promise<CutoutBuildResult> {
  const { dir, imageUrl, sourceRef, params, onProgress } = input
  onProgress?.('元画像を読み込み中…')
  const original = await decodeBlob(await fetchBlob(imageUrl))

  const req = buildEngineRequest(params, imageUrl)
  onProgress?.(`${CUTOUT_ENGINES[params.engine].label} で処理中…`)
  const result = await fal.subscribe(req.endpoint, { input: req.input, logs: false })
  const output = (result as unknown as { data?: unknown }).data
  const resultFile = pickEngineResult(params.engine, output)

  return buildCutoutFromEngineResult({ engine: params.engine, original, resultFile, params, dir, sourceRef, onProgress })
}

/** 保存済みの生マスクにパラメータを再適用し、プレビューを作り直す（fal は呼ばない）。 */
export async function reapplyCutoutParams(input: {
  ref: CutoutRef
  rawAlpha: AlphaMap
  original: DecodedImage
  params: CutoutParams
  dir: string
}): Promise<CutoutRef> {
  const { ref, rawAlpha, original, params, dir } = input
  const { alpha, bbox } = processAlpha(rawAlpha, params)
  const previewPath = `${dir}/${Date.now()}-preview.png`
  await uploadBatchObject(previewPath, await renderTransparentPng(original, alpha, PREVIEW_MAX_EDGE))
  return { ...ref, previewPath, bbox, params: { ...params }, createdAt: new Date().toISOString() }
}

/** フル解像度の透過 PNG（評価/ダウンロード用）。 */
export async function renderCutoutFullPng(original: DecodedImage, rawAlpha: AlphaMap, params: CutoutParams): Promise<Blob> {
  const { alpha } = processAlpha(rawAlpha, params)
  return renderTransparentPng(original, alpha)
}

/** 保存済みの生マスク（署名 URL）を読み戻す。 */
export async function loadRawAlpha(maskSignedUrl: string, width: number, height: number): Promise<AlphaMap> {
  return decodeMaskPng(await fetchBlob(maskSignedUrl), width, height)
}

/** 元画像（署名 URL）を読み戻す。 */
export async function loadOriginal(imageUrl: string): Promise<DecodedImage> {
  return decodeBlob(await fetchBlob(imageUrl))
}
