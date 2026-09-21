// RemoveBackgroundNode の入出力ハンドルと、上流ノードからの画像 URL の取り出し。
// ハンドル ID は BaseNode の規約 `in-<portType>-<id>` / `out-<portType>-<id>` に従う。

export const REMOVE_BACKGROUND_INPUT_HANDLE = 'in-image-image'
export const REMOVE_BACKGROUND_OUTPUT_HANDLE = 'out-cutout-cutout'

/**
 * 上流ノードの data から画像 URL を取り出す。
 * ReferenceImage: imageUrl（署名 URL。blob プレビューは fal から到達できないので使わない）
 * ImageDisplay: output（生成画像の署名 URL）または params.imageUrl
 */
export function imageUrlFromNodeData(d: Record<string, unknown> | undefined): string | null {
  if (!d) return null
  if (typeof d.output === 'string' && d.output) return d.output
  if (typeof d.imageUrl === 'string' && d.imageUrl) return d.imageUrl
  const p = d.params as Record<string, unknown> | undefined
  if (p && typeof p.imageUrl === 'string' && p.imageUrl) return p.imageUrl
  return null
}
