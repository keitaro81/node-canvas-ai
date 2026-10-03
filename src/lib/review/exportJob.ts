// ジョブの書き出し（仕様 5 章。範囲は「チェックした写真」か「すべて」）: 実行者でフル解像度を描き、形式変換して ZIP に逐次書き込む。
// 列 = レイアウト（切り抜きがあるジョブ: バリアント、無ければ切り抜きの透過 PNG）＋ 生成結果（ノードごと。フォルダ名 = ノード名）
import type { ExportParams } from '../../types/nodes'
import type { BatchItemRow } from '../../types/batch'
import { EXT_OF } from '../export/naming'
import type { LayoutExecutor } from './executor'
import { CancelledError } from './executor'
import { CUTOUT_VARIANT_KEY, estimateZipBytes, exportColumnsOf, jobZipName, planJobExport, resultKindOf, type ExportColumn, type ReviewResultColumn } from './model'
import { completedResultOf, renderableOf, type DoneTask, type ItemRenderable, type ReviewContext } from './reviewStore'
import { signBatchPaths } from '../cutout/store'
import { ZipWriter } from './zipStream'

export interface ExportProgress { done: number; total: number; message: string }
export interface ExportOutcome { blob: Blob | null; name: string; files: number; warnings: string[]; cancelled: boolean; bytes: number }

export const ZIP_WARN_BYTES = 1024 * 1024 * 1024

export type ExportScope = 'selected' | 'all'

/** 書き出せる写真: レイアウトが描ける（切り抜き完了）か、完了した生成結果が 1 つ以上ある */
export interface ExportTarget { item: BatchItemRow; renderable: ItemRenderable | null; results: Array<{ column: ReviewResultColumn; task: DoneTask }> }

export function exportColumnsFor(ctx: ReviewContext, includeCutout = false): ExportColumn[] {
  return exportColumnsOf(ctx.variants, ctx.results, !!ctx.cutoutNodeId, includeCutout)
}

export function exportTargets(ctx: ReviewContext, scope: ExportScope, selected?: ReadonlySet<string>): ExportTarget[] {
  return ctx.items
    .filter((item) => scope === 'all' || !!selected?.has(item.id))
    .map((item) => ({
      item,
      renderable: renderableOf(ctx, item),
      results: ctx.results.map((column) => ({ column, task: completedResultOf(ctx, item.id, column.nodeId) })).filter((x): x is { column: ReviewResultColumn; task: DoneTask } => !!x.task),
    }))
    .filter((t) => !!t.renderable || t.results.length > 0)
}

/** 書き出すファイル数（写真ごとに、描けるレイアウト列 + 完了した結果列） */
export function exportFileCount(ctx: ReviewContext, targets: ExportTarget[], includeCutout = false): number {
  const layoutCols = exportColumnsFor(ctx, includeCutout).filter((c) => c.kind === 'variant').length
  return targets.reduce((s, t) => s + (t.renderable ? layoutCols : 0) + t.results.length, 0)
}

export async function exportJobZip(opts: {
  ctx: ReviewContext
  jobName: string
  scope: ExportScope
  selected?: ReadonlySet<string>
  params: ExportParams
  executor: LayoutExecutor
  isCancelled: () => boolean
  onProgress: (p: ExportProgress) => void
}): Promise<ExportOutcome> {
  const { ctx, params, executor } = opts
  const now = new Date()
  const targets = exportTargets(ctx, opts.scope, opts.selected)
  const columns = exportColumnsFor(ctx, params.includeCutout)
  const layoutColumns = columns.filter((c) => c.kind === 'variant')
  const plan = planJobExport(targets.map((t) => t.item), columns, params, now)
  const total = exportFileCount(ctx, targets, params.includeCutout)
  const warnings: string[] = []
  const zip = new ZipWriter()
  const writes: Promise<void>[] = []
  let done = 0
  let files = 0
  const name = jobZipName(opts.jobName, now)
  const maxBytes = params.maxFileKb ? params.maxFileKb * 1024 : null
  const put = (path: string, res: { blob: Blob; warnings: string[] }) => {
    for (const w of res.warnings) warnings.push(`${path}: ${w}`)
    writes.push(res.blob.arrayBuffer().then((buf) => { zip.add(path, new Uint8Array(buf)); files++ }).catch((e) => { warnings.push(`${path}: ${e instanceof Error ? e.message : String(e)}`) }))
    done++
    opts.onProgress({ done, total, message: path })
  }
  try {
    for (let i = 0; i < targets.length; i++) {
      if (opts.isCancelled()) return { blob: null, name, files, warnings, cancelled: true, bytes: zip.size }
      const t = targets[i]
      const entries = plan[i].entries
      for (const w of plan[i].warnings) warnings.push(`${t.item.sku}: ${w}`)
      opts.onProgress({ done, total, message: `${i + 1} / ${targets.length}: ${t.item.sku} を描画中…` })
      // レイアウト列（切り抜き + バリアント）
      if (t.renderable && layoutColumns.length) {
        const r = t.renderable
        const paths = [r.sourcePath, r.task.result_path ?? '']
        const signed = await signBatchPaths(paths)
        const assets = { originalUrl: signed[r.sourcePath], resultUrl: signed[r.task.result_path ?? ''], resultKind: resultKindOf(r.task) }
        if (!assets.originalUrl || !assets.resultUrl) { warnings.push(`${t.item.sku}: 画像を取得できないため飛ばしました`); done += layoutColumns.length }
        else {
          const variants = layoutColumns.map((c) => {
            const v = c.variant!
            const ci = columns.indexOf(c)
            return {
              key: v.key, params: v.params,
              backgroundUrl: v.backgroundNodeId ? ctx.backgroundUrls[v.backgroundNodeId] ?? null : null,
              encode: { format: entries[ci].format, quality: params.jpegQuality, maxBytes },
            }
          })
          await executor.renderFull({ assets, cutout: r.cutout, variants }, (res) => {
            const ci = columns.findIndex((c) => c.kind === 'variant' && c.key === res.key)
            const entry = entries[ci]
            if (!entry) return
            put(`${entry.folder}${entry.base}.${EXT_OF[res.format]}`, res)
          })
        }
      }
      // 生成結果の列（ノードごと。結果ファイルを Export の形式に変換）
      for (const { column, task } of t.results) {
        if (opts.isCancelled()) return { blob: null, name, files, warnings, cancelled: true, bytes: zip.size }
        const ci = columns.findIndex((c) => c.kind === 'result' && c.key === column.key)
        const entry = entries[ci]
        if (!entry || !task.result_path) continue
        const signed = await signBatchPaths([task.result_path])
        const url = signed[task.result_path]
        if (!url) { warnings.push(`${t.item.sku}: ${column.name} の結果を取得できないため飛ばしました`); done++; continue }
        await executor.renderImageFull({ key: column.key, url, encode: { format: entry.format, quality: params.jpegQuality, maxBytes } }, (res) => {
          put(`${entry.folder}${entry.base}.${EXT_OF[res.format]}`, res)
        })
      }
    }
  } catch (e) {
    if (e instanceof CancelledError) { await Promise.all(writes); return { blob: null, name, files, warnings, cancelled: true, bytes: zip.size } }
    throw e
  }
  await Promise.all(writes)
  const blob = zip.finish()
  return { blob, name, files, warnings, cancelled: false, bytes: blob.size }
}

export function estimateExportBytes(ctx: ReviewContext, scope: ExportScope, params: ExportParams, selected?: ReadonlySet<string>): number {
  const targets = exportTargets(ctx, scope, selected)
  const nLayout = targets.filter((t) => t.renderable).length
  const first = ctx.items.find((i) => i.width && i.height)
  const w0 = first?.width ?? 1200, h0 = first?.height ?? 1200
  let bytes = 0
  for (const c of exportColumnsFor(ctx, params.includeCutout)) {
    if (c.kind === 'variant') {
      const v = c.variant!
      // 切り抜き列は元画像サイズの透過 PNG
      if (v.key === CUTOUT_VARIANT_KEY) bytes += estimateZipBytes(nLayout, w0, h0, 'png')
      else bytes += estimateZipBytes(nLayout, v.params.width, v.params.height, v.params.backgroundKind === 'transparent' ? 'png' : params.format)
    } else {
      for (const t of targets) {
        const r = t.results.find((x) => x.column.key === c.key)
        if (!r) continue
        bytes += estimateZipBytes(1, r.task.result_meta?.width ?? t.item.width ?? w0, r.task.result_meta?.height ?? t.item.height ?? h0, params.format)
      }
    }
  }
  return bytes
}
