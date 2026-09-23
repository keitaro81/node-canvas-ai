// ExportNode の純関数: ファイル名の規則・重複回避・フォルダ分け・パラメータ正規化（仕様 3-4）。
import type { BatchItemInfo, ExportFormat, ExportParams, ExportZipFolders } from '../../types/nodes'

export const DEFAULT_EXPORT_PARAMS: ExportParams = {
  namePattern: '{sku}_{variant}_{index:02}',
  format: 'jpeg',
  jpegQuality: 90,
  maxFileKb: null,
  zip: true,
  zipFolders: 'variant',
}

export const EXPORT_MIN_QUALITY = 70

export function normalizeExportParams(p: unknown): ExportParams {
  const s = (p && typeof p === 'object' ? p : {}) as Partial<Record<keyof ExportParams, unknown>>
  const d = DEFAULT_EXPORT_PARAMS
  const format: ExportFormat = s.format === 'png' || s.format === 'webp' ? s.format : 'jpeg'
  const zipFolders: ExportZipFolders = s.zipFolders === 'sku' || s.zipFolders === 'none' ? s.zipFolders : 'variant'
  const q = typeof s.jpegQuality === 'number' && Number.isFinite(s.jpegQuality) ? Math.round(s.jpegQuality) : d.jpegQuality
  const kb = typeof s.maxFileKb === 'number' && Number.isFinite(s.maxFileKb) && s.maxFileKb > 0 ? Math.round(s.maxFileKb) : null
  return {
    namePattern: typeof s.namePattern === 'string' && s.namePattern.trim() ? s.namePattern.trim() : d.namePattern,
    format,
    jpegQuality: Math.min(100, Math.max(EXPORT_MIN_QUALITY, q)),
    maxFileKb: kb,
    zip: typeof s.zip === 'boolean' ? s.zip : d.zip,
    zipFolders,
  }
}

export const EXT_OF: Record<ExportFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }
export const MIME_OF: Record<ExportFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** JST の YYYYMMDD */
export function dateToken(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10).replace(/-/g, '')
}

/** ファイル名に使えない文字を _ に。パス区切り・制御文字も含む。 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\p{Cc}/gu, '_').replace(/\s+$/g, '').replace(/^\.+/, '') || 'file'
}

export interface NameContext extends BatchItemInfo {
  variant: string
  now: Date
}

/**
 * 規則を展開する。トークン: {sku} {original} {variant} {index} {index:02}（桁数指定 {index:0N}） {date}
 * 未知のトークンはそのまま残す（入力ミスに気づけるように）。
 */
export function applyNamePattern(pattern: string, ctx: NameContext): string {
  const out = pattern.replace(/\{(sku|original|variant|index(?::0(\d+))?|date)\}/g, (_m, token: string, pad?: string) => {
    if (token === 'sku') return ctx.sku
    if (token === 'original') return ctx.original
    if (token === 'variant') return ctx.variant
    if (token === 'date') return dateToken(ctx.now)
    if (token.startsWith('index')) return pad ? String(ctx.index).padStart(Number(pad), '0') : String(ctx.index)
    return _m
  })
  return sanitizeFileName(out)
}

export interface PlannedInput {
  variant: string
  transparent: boolean             // 背景が透過のバリアント（JPEG 指定なら PNG に切り替える）
}

export interface PlannedEntry {
  variant: string
  folder: string                   // '' または 'ec_white/' のように末尾スラッシュ付き
  base: string                     // 拡張子なしのファイル名（重複回避後）
  format: ExportFormat
  ext: string
  warnings: string[]
}

export function folderFor(grouping: ExportZipFolders, variant: string, sku: string): string {
  if (grouping === 'variant') return `${sanitizeFileName(variant) || 'variant'}/`
  if (grouping === 'sku') return `${sanitizeFileName(sku) || 'sku'}/`
  return ''
}

/**
 * 接続中の入力（バリアント）に規則を適用し、フォーマット切替・重複回避まで決める（決定的）。
 * - 透過バリアントに JPEG → PNG に切り替えて警告
 * - 同じパスになるものは 2 つ目以降に _2, _3 … を付けて警告
 */
export function planExportEntries(inputs: PlannedInput[], params: ExportParams, item: BatchItemInfo, now: Date): { entries: PlannedEntry[]; warnings: string[] } {
  const warnings: string[] = []
  const used = new Map<string, number>()
  const entries = inputs.map((inp) => {
    const w: string[] = []
    let format = params.format
    if (inp.transparent && format === 'jpeg') {
      format = 'png'
      w.push(`「${inp.variant}」は背景が透過のため JPEG ではなく PNG で書き出します`)
    }
    const ext = EXT_OF[format]
    const folder = params.zip ? folderFor(params.zipFolders, inp.variant, item.sku) : ''
    let base = applyNamePattern(params.namePattern, { ...item, variant: inp.variant, now })
    const key = `${folder}${base}.${ext}`.toLowerCase()
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    if (n > 1) {
      base = `${base}_${n}`
      w.push(`ファイル名が重複したため連番を付けました: ${folder}${base}.${ext}`)
    }
    warnings.push(...w)
    return { variant: inp.variant, folder, base, format, ext, warnings: w }
  })
  return { entries, warnings }
}

/** 品質の段階（開始値から 5 刻みで下限 70 まで）。最大ファイルサイズ指定時に使う。 */
export function qualitySteps(start: number): number[] {
  const s = Math.min(100, Math.max(EXPORT_MIN_QUALITY, Math.round(start)))
  const steps: number[] = []
  for (let q = s; q >= EXPORT_MIN_QUALITY; q -= 5) steps.push(q)
  if (steps[steps.length - 1] !== EXPORT_MIN_QUALITY) steps.push(EXPORT_MIN_QUALITY)
  return steps
}

/** ZIP のファイル名 */
export function zipFileName(item: BatchItemInfo, now: Date): string {
  return sanitizeFileName(`${item.sku}_${dateToken(now)}.zip`)
}
