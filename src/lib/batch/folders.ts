// ライブラリの「一括処理のフォルダ」（2026-10-31・ユーザー提案を承認）の純関数。
// 切り抜き・レイアウト・AI 処理の 1 ジョブを 1 つのフォルダにし、中身は確認グリッドと同じ列（切り抜き / バリアント / 生成結果）の最終結果だけ（元の写真は含めない）。
// 商品動画は SKU ごとの単独カードのまま（batchVideos.ts）。
import type { BatchOutputRow } from '../../types/batch'
import { CUTOUT_VARIANT_KEY, isResultKey, type ReviewResultColumn, type ReviewVariant } from '../review/model'
import { formatJst } from './dates'
import { isAutoJobName } from './jobLabel'

/** カードに重ねて見せる写真の数（先頭の写真から） */
export const PREVIEW_ITEMS = 3

/** 列の種類ごとの並び: レイアウト（バリアント） > 生成結果 > 切り抜き（透過のままで一覧には向かない） */
const rankOf = (variant: string): number => (variant === CUTOUT_VARIANT_KEY ? 2 : isResultKey(variant) ? 1 : 0)

/**
 * フォルダカードの重ねサムネイル（ジョブ id → batch パス最大 3 つ）。先頭の写真の記録済みサムネイル（確認グリッドが保存したもの）から選ぶ。
 * 列はジョブ内で揃える（持っている写真が最も多い列。同数ならレイアウト > 生成結果 > 切り抜き）。同じ写真 × 列に複数の記録があれば新しいもの。
 * 記録が無い写真は飛ばす（開いたときに描かれ、次からは出る）
 */
export function previewPathsOf(
  items: Array<{ id: string; job_id: string; sort_order: number }>,
  outputs: Array<Pick<BatchOutputRow, 'item_id' | 'variant' | 'output_path' | 'created_at'>>,
): Record<string, string[]> {
  const byJob = new Map<string, Array<{ id: string; sort_order: number }>>()
  for (const it of items) { const l = byJob.get(it.job_id) ?? []; l.push(it); byJob.set(it.job_id, l) }
  const byItem = new Map<string, Array<Pick<BatchOutputRow, 'item_id' | 'variant' | 'output_path' | 'created_at'>>>()
  for (const o of outputs) { const l = byItem.get(o.item_id) ?? []; l.push(o); byItem.set(o.item_id, l) }
  const out: Record<string, string[]> = {}
  for (const [jobId, list] of byJob) {
    const heads = list.slice().sort((a, b) => a.sort_order - b.sort_order).slice(0, PREVIEW_ITEMS)
    const score = new Map<string, number>()
    for (const h of heads) for (const v of new Set((byItem.get(h.id) ?? []).map((o) => o.variant))) score.set(v, (score.get(v) ?? 0) + 1)
    const chosen = [...score.entries()].sort((a, b) => b[1] - a[1] || rankOf(a[0]) - rankOf(b[0]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null
    const paths: string[] = []
    for (const h of heads) {
      const os = (byItem.get(h.id) ?? []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      const pick = (chosen ? os.find((o) => o.variant === chosen) : undefined) ?? os.slice().sort((a, b) => rankOf(a.variant) - rankOf(b.variant))[0]
      if (pick) paths.push(pick.output_path)
    }
    out[jobId] = paths
  }
  return out
}

export type FolderColumnKind = 'cutout' | 'variant' | 'result'
export interface FolderColumn {
  key: string                    // CUTOUT_VARIANT_KEY / Product Layout ノード id / '__result:<nodeId>'
  name: string
  size: string                   // タブの補足（'元のサイズ' / '1200×1200' / '生成結果'）
  kind: FolderColumnKind
  width: number | null           // バリアントだけ決まっている（切り抜き・生成結果は写真ごと）
  height: number | null
}

/** フォルダの列（確認グリッドのタブと同じ並び）: 切り抜き + バリアント（切り抜きノードがあるジョブ）＋ 生成結果（ノードごと） */
export function folderColumnsOf(hasCutout: boolean, variants: ReviewVariant[], results: ReviewResultColumn[]): FolderColumn[] {
  return [
    ...(hasCutout ? [
      { key: CUTOUT_VARIANT_KEY, name: '切り抜き', size: '元のサイズ', kind: 'cutout' as const, width: null, height: null },
      ...variants.map((v): FolderColumn => ({ key: v.key, name: v.name, size: `${v.params.width}×${v.params.height}`, kind: 'variant', width: v.params.width, height: v.params.height })),
    ] : []),
    ...results.map((r): FolderColumn => ({ key: r.key, name: r.name, size: '生成結果', kind: 'result', width: null, height: null })),
  ]
}

/** タイルの鍵（写真 id|列キー）。reviewStore の thumbKey と同じ形 */
export function parseTileKey(k: string): { itemId: string; key: string } {
  const i = k.indexOf('|')
  return i < 0 ? { itemId: k, key: '' } : { itemId: k.slice(0, i), key: k.slice(i + 1) }
}

/** フォルダの表示名: 名前を付けた処理はその名前、自動命名（日時 枚数）は日時だけ */
export function folderTitle(folder: { jobName: string; createdAt: string }): string {
  return isAutoJobName(folder.jobName) ? formatJst(folder.createdAt) : folder.jobName.trim()
}

/** フォルダから選んだ画像の名前（SKU_列名。ファイル名に使えない文字は _） */
export function folderImageName(sku: string, columnName: string): string {
  return `${sku || 'image'}_${columnName}`.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
}
