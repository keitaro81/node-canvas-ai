// ジョブの書き出し（仕様 5 章「OK のみ書き出し / すべて書き出し」）: 実行者でフル解像度を描き、形式変換して ZIP に逐次書き込む。
import type { ExportParams } from '../../types/nodes'
import { EXT_OF } from '../export/naming'
import type { LayoutExecutor } from './executor'
import { CancelledError } from './executor'
import { estimateZipBytes, jobZipName, planJobExport, resultKindOf } from './model'
import { renderableOf, type ReviewContext } from './reviewStore'
import { signBatchPaths } from '../cutout/store'
import { ZipWriter } from './zipStream'

export interface ExportProgress { done: number; total: number; message: string }
export interface ExportOutcome { blob: Blob | null; name: string; files: number; warnings: string[]; cancelled: boolean; bytes: number }

export const ZIP_WARN_BYTES = 1024 * 1024 * 1024

export function exportTargets(ctx: ReviewContext, scope: 'ok' | 'all') {
  return ctx.items
    .map((item) => renderableOf(ctx, item))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .filter((r) => scope === 'all' || r.item.review === 'ok')
}

export async function exportJobZip(opts: {
  ctx: ReviewContext
  jobName: string
  scope: 'ok' | 'all'
  params: ExportParams
  executor: LayoutExecutor
  isCancelled: () => boolean
  onProgress: (p: ExportProgress) => void
}): Promise<ExportOutcome> {
  const { ctx, params, executor } = opts
  const now = new Date()
  const targets = exportTargets(ctx, opts.scope)
  const plan = planJobExport(targets.map((t) => t.item), ctx.variants, params, now)
  const total = targets.length * ctx.variants.length
  const warnings: string[] = []
  const zip = new ZipWriter()
  const writes: Promise<void>[] = []
  let done = 0
  let files = 0
  const name = jobZipName(opts.jobName, now)
  try {
    for (let i = 0; i < targets.length; i++) {
      if (opts.isCancelled()) return { blob: null, name, files, warnings, cancelled: true, bytes: zip.size }
      const r = targets[i]
      const entries = plan[i].entries
      for (const w of plan[i].warnings) warnings.push(`${r.item.sku}: ${w}`)
      opts.onProgress({ done, total, message: `${i + 1} / ${targets.length}: ${r.item.sku} を描画中…` })
      const originalPath = r.item.source_path ?? r.item.interactive_path ?? ''
      const paths = [originalPath, r.task.result_path ?? '']
      const bgPaths: string[] = []
      const signed = await signBatchPaths([...paths, ...bgPaths])
      const assets = { originalUrl: signed[originalPath], resultUrl: signed[r.task.result_path ?? ''], resultKind: resultKindOf(r.task) }
      if (!assets.originalUrl || !assets.resultUrl) { warnings.push(`${r.item.sku}: 画像を取得できないため飛ばしました`); done += ctx.variants.length; continue }
      const variants = ctx.variants.map((v, vi) => ({
        key: v.key, params: v.params,
        backgroundUrl: v.backgroundNodeId ? ctx.backgroundUrls[v.backgroundNodeId] ?? null : null,
        encode: { format: entries[vi].format, quality: params.jpegQuality, maxBytes: params.maxFileKb ? params.maxFileKb * 1024 : null },
      }))
      await executor.renderFull({ assets, cutout: r.cutout, variants }, (res) => {
        const vi = ctx.variants.findIndex((v) => v.key === res.key)
        const entry = entries[vi]
        if (!entry) return
        const path = `${entry.folder}${entry.base}.${EXT_OF[res.format]}`
        for (const w of res.warnings) warnings.push(`${path}: ${w}`)
        writes.push(res.blob.arrayBuffer().then((buf) => { zip.add(path, new Uint8Array(buf)); files++ }).catch((e) => { warnings.push(`${path}: ${e instanceof Error ? e.message : String(e)}`) }))
        done++
        opts.onProgress({ done, total, message: `${path}` })
      })
    }
  } catch (e) {
    if (e instanceof CancelledError) { await Promise.all(writes); return { blob: null, name, files, warnings, cancelled: true, bytes: zip.size } }
    throw e
  }
  await Promise.all(writes)
  const blob = zip.finish()
  return { blob, name, files, warnings, cancelled: false, bytes: blob.size }
}

export function estimateExportBytes(ctx: ReviewContext, scope: 'ok' | 'all', params: ExportParams): number {
  const n = exportTargets(ctx, scope).length
  return ctx.variants.reduce((s, v) => s + estimateZipBytes(n, v.params.width, v.params.height, v.params.backgroundKind === 'transparent' ? 'png' : params.format), 0)
}
