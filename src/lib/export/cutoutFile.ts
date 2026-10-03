// 書き出し用の切り抜き画像: Remove Background の出力（CutoutRef）から、しきい値・ぼかしを適用したフル解像度の透過 PNG を作る。
// Export ノードの「切り抜きの透過 PNG も書き出す」が使う（ジョブの書き出しは Worker 側の renderItemFull が同じ結果を作る）。
import type { CutoutRef } from '../../types/nodes'
import { signMediaRequest } from '../api/storage'
import { resolveFetchableUrl, signBatchPath } from '../cutout/store'
import { loadOriginal, loadRawAlpha, renderCutoutFullPng } from '../cutout/runCutout'

export async function renderCutoutPngForExport(input: { ref: CutoutRef; workflowId: string | null; liveUrl?: string | null }): Promise<Blob> {
  const { ref, workflowId, liveUrl } = input
  // 元画像: ワークフロー認可の再署名 → batch チーム署名 → 上流ノードが今持っている URL の順（RemoveBackgroundNode と同じ）
  const originalUrl = await resolveFetchableUrl({
    canonical: ref.sourceRef,
    fresh: async () => (workflowId ? (await signMediaRequest({ workflowId }))[ref.sourceRef] : null),
    liveUrl,
  })
  const maskUrl = await signBatchPath(ref.maskPath)
  if (!maskUrl) throw new Error('切り抜きのマスクを取得できません（チームの権限を確認してください）')
  const [original, rawAlpha] = await Promise.all([loadOriginal(originalUrl), loadRawAlpha(maskUrl, ref.width, ref.height)])
  if (original.width !== ref.width || original.height !== ref.height) {
    throw new Error('元画像の寸法が切り抜き実行時と異なります。Remove Background を再実行してください')
  }
  return renderCutoutFullPng(original, rawAlpha, ref.params)
}
