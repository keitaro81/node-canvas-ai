// BatchInputNode の純関数: SKU 抽出・並び順・正規化（仕様 3-1）。
import type { BatchInputParams, BatchItem, BatchItemInfo } from '../../types/nodes'

export const MAX_BATCH_ITEMS = 50

/** 既定: ファイル名の先頭から最初のアンダースコアまでの英数字とハイフン */
export const DEFAULT_SKU_PATTERN = '^([A-Za-z0-9-]+)_'

export const DEFAULT_BATCH_INPUT_PARAMS: BatchInputParams = {
  skuPattern: DEFAULT_SKU_PATTERN,
  sortOrder: 'filename',
}

export function normalizeBatchInputParams(p: unknown): BatchInputParams {
  const s = (p && typeof p === 'object' ? p : {}) as Partial<Record<keyof BatchInputParams, unknown>>
  return {
    skuPattern: typeof s.skuPattern === 'string' && s.skuPattern.trim() ? s.skuPattern : DEFAULT_SKU_PATTERN,
    sortOrder: 'filename',
  }
}

/** 拡張子を除いたファイル名 */
export function stripExtension(name: string): string {
  const base = name.replace(/^.*[\\/]/, '')
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(0, i) : base
}

/** 正規表現をコンパイルする（不正なら null）。 */
export function compileSkuPattern(pattern: string): RegExp | null {
  try { return new RegExp(pattern) } catch { return null }
}

/**
 * SKU を抽出する。最初に一致した部分（グループがあれば第 1 グループ）。一致しなければ拡張子を除いたファイル名。
 * 不正な正規表現も「一致しない」扱い。
 */
export function extractSku(fileName: string, pattern: string): string {
  const base = stripExtension(fileName)
  const re = compileSkuPattern(pattern)
  if (re) {
    const m = re.exec(base)
    const hit = m ? (m[1] ?? m[0]) : ''
    if (hit) return hit
  }
  return base
}

/** ファイル名の自然順比較（img2 < img10。大文字小文字は区別しない） */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** ファイル名順に並べ替え、index（1 始まり）を振り直す。 */
export function sortAndIndexItems<T extends { originalName: string; index: number }>(items: T[]): T[] {
  return [...items]
    .sort((x, y) => naturalCompare(x.originalName, y.originalName))
    .map((it, i) => (it.index === i + 1 ? it : { ...it, index: i + 1 }))
}

/** SKU をパラメータに従って付け直す（パターン変更時）。 */
export function applySkuPattern<T extends { originalName: string; sku: string }>(items: T[], pattern: string): T[] {
  return items.map((it) => {
    const sku = extractSku(it.originalName, pattern)
    return sku === it.sku ? it : { ...it, sku }
  })
}

export function itemInfoOf(item: Pick<BatchItem, 'sku' | 'originalName' | 'index'>): BatchItemInfo {
  return { sku: item.sku, original: stripExtension(item.originalName), index: item.index }
}

/** 保存先パス用に安全なファイル名にする（英数字・.-_ 以外は _）。 */
export function safeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '')
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file'
}
