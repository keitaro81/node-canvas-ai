// 切り抜き画像（透過 PNG）が無い Remove Background の結果から、その場で作って保存する（2026-11-01・メモ 12）。
// 以前は「後段があるときだけ保存」だったので、つなぐ順番によって Try-On / Image Generation が止まっていた。今は常に保存するが、古い結果にはこれで補う。
// マスク（batch バケット）と元画像（参照画像・生成画像・batch）をブラウザで読み、「透過 PNG」ダウンロードと同じ描画で作る。fal は呼ばない
import { interactiveCutoutDir, resolveFetchableUrl, resolveTeamId, signBatchPath, uploadBatchObject } from './store'
import { loadOriginal, loadRawAlpha, renderCutoutFullPng } from './runCutout'
import { signMediaRequest } from '../api/storage'
import type { CutoutRef } from '../../types/nodes'

export async function ensureCutoutImage(ref: CutoutRef, nodeId: string, workflowId: string | null, liveSourceUrl?: string | null): Promise<{ ref: CutoutRef; signedUrl: string }> {
  if (ref.cutoutPath) {
    const signed = await signBatchPath(ref.cutoutPath)
    if (signed) return { ref, signedUrl: signed }
  }
  const maskUrl = await signBatchPath(ref.maskPath)
  if (!maskUrl) throw new Error('切り抜きのマスクを取得できません（チームの権限を確認してください）')
  const sourceUrl = await resolveFetchableUrl({
    canonical: ref.sourceRef,
    fresh: async () => (await signMediaRequest(workflowId ? { workflowId, urls: [ref.sourceRef], ownUrls: [ref.sourceRef] } : { urls: [ref.sourceRef], ownUrls: [ref.sourceRef] }))[ref.sourceRef],
    liveUrl: liveSourceUrl,
  })
  if (sourceUrl === ref.sourceRef) throw new Error('切り抜きの元画像を取得できません。Remove Background を再実行してください')
  const [original, rawAlpha] = await Promise.all([loadOriginal(sourceUrl), loadRawAlpha(maskUrl, ref.width, ref.height)])
  if (original.width !== ref.width || original.height !== ref.height) throw new Error('元画像の寸法が切り抜き時と異なります。Remove Background を再実行してください')
  const png = await renderCutoutFullPng(original, rawAlpha, ref.params)
  const teamId = await resolveTeamId()
  const cutoutPath = `${interactiveCutoutDir(teamId, nodeId)}/${Date.now()}-cutout.png`
  await uploadBatchObject(cutoutPath, png)
  const signed = await signBatchPath(cutoutPath)
  if (!signed) throw new Error('切り抜き画像を保存できましたが取得できません')
  return { ref: { ...ref, cutoutPath }, signedUrl: signed }
}
