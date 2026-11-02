// 一括処理の種類の表示名（実行前の確認・App の「処理内容」で共用・2026-11-02 段階 4）。処理は写真ごと（動画の一括は廃止・SKU カードは無い）
import type { PlannedKind } from './plan'

export const PLANNED_KIND_LABEL: Record<PlannedKind, string> = {
  cutout: '切り抜き',
  imageEdit: '画像生成（写真ごと）',
  imageGen: '背景生成',
  videoShot: '動画（写真ごと）',
  videoMerge: '結合（写真ごと）',
}
export const kindLabel = (kind: string): string => (PLANNED_KIND_LABEL as Record<string, string>)[kind] ?? kind
