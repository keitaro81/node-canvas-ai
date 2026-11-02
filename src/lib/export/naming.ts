// ExportNode の純関数: ファイル名の規則・重複回避・フォルダ分け・パラメータ正規化（仕様 3-4）。
import type { BatchItemInfo, ExportFormat, ExportParams, ExportZipFolders } from '../../types/nodes'

export const DEFAULT_EXPORT_PARAMS: ExportParams = {
  namePattern: '{sku}_{variant}_{index:02}',
  format: 'jpeg',
  jpegQuality: 90,
  maxFileKb: null,
  zip: true,
  zipFolders: 'variant',
  includeCutout: true,
  productName: '',
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
    includeCutout: typeof s.includeCutout === 'boolean' ? s.includeCutout : d.includeCutout,
    productName: typeof s.productName === 'string' ? s.productName.slice(0, 120) : d.productName,
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
  forcePng?: boolean               // 常に PNG（切り抜きの透過画像）。警告は出さない
  video?: boolean                  // 動画（mp4 のまま。形式・品質は適用しない）
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
export function planExportEntries(inputs: PlannedInput[], params: ExportParams, item: BatchItemInfo, now: Date, opts?: { skus?: number }): { entries: PlannedEntry[]; warnings: string[] } {
  const warnings: string[] = []
  const used = new Map<string, number>()
  // フォルダ分けの対象が 1 つだけ（バリアント 1 種類 / SKU 1 件）なら、フォルダを作らずルート直下に（2026-11-01 メモ 34）
  const variantCount = new Set(inputs.map((i) => i.variant)).size
  const flat = (params.zipFolders === 'variant' && variantCount <= 1) || (params.zipFolders === 'sku' && opts?.skus === 1)
  const entries = inputs.map((inp) => {
    const w: string[] = []
    let format = params.format
    if (inp.forcePng) format = 'png'
    else if (inp.transparent && format === 'jpeg') {
      format = 'png'
      w.push(`「${inp.variant}」は背景が透過のため JPEG ではなく PNG で書き出します`)
    }
    const ext = inp.video ? 'mp4' : EXT_OF[format]
    const folder = params.zip && !flat ? folderFor(params.zipFolders, inp.variant, item.sku) : ''
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
export function zipFileName(item: BatchItemInfo, now: Date, baseOverride?: string | null): string {
  const base = (baseOverride ?? '').trim() || item.sku
  return sanitizeFileName(`${base}_${dateToken(now)}.zip`)
}

/** 規則の中の置き換えできない {…}（固定の文字を {} で囲んだときなど。2026-11-01 の指摘）。固定の文字は {} なしで書く */
export function unknownTokens(pattern: string): string[] {
  const out: string[] = []
  for (const m of pattern.matchAll(/\{([^{}]*)\}/g)) { const t = m[1]; if (!/^(sku|original|variant|index(?::0\d+)?|date)$/.test(t)) out.push(`{${t}}`) }
  return [...new Set(out)]
}

// ───────── 名前の付け方（2026-11-02 メモ 43: 記号を書かせず、型を選ぶ＋部品を並べる。保存は今までどおり記号の文字列） ─────────
/** 名前の部品。text は固定の文字（区切りの「_」も文字の部品） */
export type NamePart = { kind: 'sku' } | { kind: 'original' } | { kind: 'variant' } | { kind: 'index'; pad: number } | { kind: 'date' } | { kind: 'text'; text: string }

/** よく使う名前の型（Lightroom の「名前の型」・Adobe Bridge の一括リネームを参考に） */
export const NAME_PRESETS: Array<{ id: string; label: string; pattern: string }> = [
  { id: 'sku_variant_index', label: '商品名_バリアント_連番', pattern: '{sku}_{variant}_{index:02}' },
  { id: 'sku_index', label: '商品名_連番', pattern: '{sku}_{index:02}' },
  { id: 'original', label: '元のファイル名', pattern: '{original}' },
  { id: 'original_variant', label: '元のファイル名_バリアント', pattern: '{original}_{variant}' },
]
export const presetIdOf = (pattern: string): string => NAME_PRESETS.find((p) => p.pattern === pattern.trim())?.id ?? 'custom'

/** 記号の文字列 → 部品（知らない {…} は固定の文字として残す） */
export function parseNamePattern(pattern: string): NamePart[] {
  const parts: NamePart[] = []
  const re = /\{(sku|original|variant|index(?::0(\d+))?|date)\}/g
  let last = 0
  for (const m of pattern.matchAll(re)) {
    if (m.index! > last) parts.push({ kind: 'text', text: pattern.slice(last, m.index) })
    const t = m[1]
    if (t === 'sku' || t === 'original' || t === 'variant' || t === 'date') parts.push({ kind: t })
    else parts.push({ kind: 'index', pad: m[2] ? Number(m[2]) : 0 })
    last = m.index! + m[0].length
  }
  if (last < pattern.length) parts.push({ kind: 'text', text: pattern.slice(last) })
  return parts
}

/** 部品 → 記号の文字列（保存の形） */
export function buildNamePattern(parts: NamePart[]): string {
  return parts.map((p) => {
    if (p.kind === 'text') return p.text
    if (p.kind === 'index') return p.pad > 0 ? `{index:0${p.pad}}` : '{index}'
    return `{${p.kind}}`
  }).join('')
}

/** 部品の表示名 */
export function namePartLabel(p: NamePart): string {
  if (p.kind === 'sku') return '商品名'
  if (p.kind === 'original') return '元のファイル名'
  if (p.kind === 'variant') return 'バリアント'
  if (p.kind === 'date') return '日付'
  if (p.kind === 'index') return p.pad > 0 ? `連番 ${p.pad} 桁` : '連番'
  return p.text
}

const SEPARATOR_END = /[_\-.\s]$/
const isSeparatorOnly = (p: NamePart | undefined): boolean => p?.kind === 'text' && /^[_\-.\s]+$/.test(p.text)
/** 隣り合う固定の文字をまとめる（記号の文字列にして読み直したときと同じ形にそろえる） */
const mergeTexts = (parts: NamePart[]): NamePart[] => parts.reduce<NamePart[]>((acc, p) => {
  const last = acc[acc.length - 1]
  if (p.kind === 'text' && last?.kind === 'text') acc[acc.length - 1] = { kind: 'text', text: last.text + p.text }
  else acc.push(p)
  return acc
}, [])

/** 部品を足す（前の部品との間に区切りの「_」が無ければ挟む） */
export function appendNamePart(parts: NamePart[], add: NamePart): NamePart[] {
  const prev = parts[parts.length - 1]
  const needSep = !!prev && !(prev.kind === 'text' && SEPARATOR_END.test(prev.text))
  return mergeTexts([...parts, ...(needSep ? [{ kind: 'text', text: '_' } as NamePart] : []), add])
}

/** 部品を外す。区切りだけの文字（_ など）が前（先頭なら後ろ）にあれば一緒に外す */
export function removeNamePart(parts: NamePart[], index: number): NamePart[] {
  const target = parts[index]
  if (!target) return parts
  const drop = new Set([index])
  if (target.kind !== 'text') {
    if (index > 0 && isSeparatorOnly(parts[index - 1])) drop.add(index - 1)
    else if (index === 0 && isSeparatorOnly(parts[1])) drop.add(1)
  }
  return mergeTexts(parts.filter((_, i) => !drop.has(i)))
}

/** 「cutout」は切り抜き PNG のフォルダ名・{variant} に使う予約名（2026-11-02 メモ 44）。バリアント名に使われていたら切り抜き PNG 側を cutout_png にする */
export const CUTOUT_NAME = 'cutout'
export const isReservedVariantName = (name: string): boolean => name.trim().toLowerCase() === CUTOUT_NAME
export const cutoutNameFor = (variantNames: string[]): string => (variantNames.some(isReservedVariantName) ? `${CUTOUT_NAME}_png` : CUTOUT_NAME)
