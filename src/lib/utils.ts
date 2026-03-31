import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** ノードのデータから画像URLを取得する共通ユーティリティ */
export function getImageUrlFromNodeData(data: unknown): string | null {
  const d = data as Record<string, unknown>
  if (typeof d.output === 'string' && d.output) return d.output
  if (typeof d.imageUrl === 'string' && d.imageUrl) return d.imageUrl
  if (typeof d.uploadedImagePreview === 'string' && d.uploadedImagePreview) return d.uploadedImagePreview
  return null
}
