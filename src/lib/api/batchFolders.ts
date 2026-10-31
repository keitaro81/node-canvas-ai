// 一括処理（切り抜き・レイアウト・AI 処理）の結果を「1 ジョブ = 1 フォルダ」でライブラリの生成画像と「画像を追加」ダイアログに並べる（2026-10-31・ユーザー提案を承認）。
// - 中身は確認グリッドと同じ列（切り抜き / バリアント / 生成結果）の最終結果だけ（元の写真は含めない）。見える範囲は RLS（can_view_batch_job）
// - 保持は処理の履歴と一緒（削除は履歴から）。商品動画は SKU ごとの単独カードのまま（batchVideos.ts）
// - レイアウト系の列（切り抜き・バリアント）はファイルが無い（確認グリッドがその場で描く）ので、選んだときにフル解像度を描いて
//   batch バケットの <team>/<job>/<item>/full-<列>-<識別値>.<ext> に保存し batch_outputs（kind 'full'）に記録する。同じ識別値なら 2 回目からは再利用
import { supabase } from '../supabase'
import type { CutoutParams, ExportFormat, ExportParams } from '../../types/nodes'
import { JOB_COLUMNS, type BatchItemRow, type BatchJobDetail, type BatchJobRow, type BatchJobStatus, type BatchOutputRow, type BatchTaskRow } from '../../types/batch'
import { fetchJobDetail, fetchJobItems, fetchJobOutputs, fetchJobTasks, fetchJobWorkflowSource, recordOutput } from './batchJobs'
import { signMediaRequest } from './storage'
import { signBatchPath, signBatchPaths, uploadBatchObjectIfMissing } from '../cutout/store'
import { normalizeCutoutParams } from '../cutout/engines'
import { resolveBackgroundSource, type BgCanvas } from '../batch/background'
import {
  ADDED_VARIANTS_KEY, CUTOUT_PREVIEW_PARAMS, CUTOUT_VARIANT_KEY, addedVariantsOf, cutoutNodesFromSnapshot, exportParamsFromSnapshot, fullFileName, isResultKey,
  resultColumnsOf, resultNodeIdOf, thumbKey, variantsFromSnapshot, type CanvasLike, type ReviewVariant,
} from '../review/model'
import { assetsFor, completedResultOf, renderableOf, type ReviewContext, type ReviewStoreApi } from '../review/reviewStore'
import type { FullResult } from '../review/renderCore'
import { batchCanonicalUrl } from './batchVideos'
import { PREVIEW_ITEMS, folderColumnsOf, folderImageName, parseTileKey, previewPathsOf, type FolderColumn } from '../batch/folders'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any

export interface BatchFolder {
  jobId: string
  teamId: string
  jobName: string
  workflowId: string | null
  createdBy: string | null
  itemCount: number
  status: BatchJobStatus
  createdAt: string
  previews: string[]            // カードに重ねる記録済みサムネイルの batch パス（最大 3。無ければ空）
}

/** PostgREST は 1 回 1000 行まで。多くなりうる読み取りはページで集める */
async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (Array.isArray(data) ? data : []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

const folderOf = (j: BatchJobRow, previews: string[]): BatchFolder => ({
  jobId: j.id, teamId: j.team_id, jobName: j.name, workflowId: j.workflow_id ?? null, createdBy: j.created_by, itemCount: j.item_count, status: j.status, createdAt: j.created_at, previews,
})

/** 終わった写真の一括処理（kind cutout。古い行は kind 無し）を新しい順に。結果が 1 つも無いものは出さない */
export async function listBatchFolders(limit = 60): Promise<BatchFolder[]> {
  const { data, error } = await sb.from('batch_jobs').select(JOB_COLUMNS)
    .or('kind.eq.cutout,kind.is.null').in('status', ['completed', 'partial_failed']).gt('completed_tasks', 0)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  const jobs = (data ?? []) as BatchJobRow[]
  if (!jobs.length) return []
  const previews = await fetchFolderPreviews(jobs.map((j) => j.id)).catch(() => ({} as Record<string, string[]>))
  return jobs.map((j) => folderOf(j, previews[j.id] ?? []))
}

/** フォルダカードの重ねサムネイル: 先頭の写真（sort_order 順）の記録済みサムネイル。無ければ空（開いたときに描かれる） */
export async function fetchFolderPreviews(jobIds: string[]): Promise<Record<string, string[]>> {
  if (!jobIds.length) return {}
  const items = await selectAll<{ id: string; job_id: string; sort_order: number }>((from, to) =>
    sb.from('batch_items').select('id, job_id, sort_order').in('job_id', jobIds).lte('sort_order', PREVIEW_ITEMS).order('job_id').order('sort_order').range(from, to))
  if (!items.length) return {}
  const outputs = await selectAll<Pick<BatchOutputRow, 'item_id' | 'variant' | 'output_path' | 'created_at'>>((from, to) =>
    sb.from('batch_outputs').select('item_id, variant, output_path, created_at').eq('kind', 'thumb').in('item_id', items.map((i) => i.id)).order('id').range(from, to))
  return previewPathsOf(items, outputs)
}

/** カードの重ねサムネイルの署名 URL（batch パス → URL。署名できないものは省略） */
export async function signFolderPreviews(folders: Array<Pick<BatchFolder, 'previews'>>): Promise<Record<string, string>> {
  const paths = [...new Set(folders.flatMap((f) => f.previews))]
  if (!paths.length) return {}
  return signBatchPaths(paths).catch(() => ({} as Record<string, string>))
}

// ───────────────────────── フォルダの中身 ─────────────────────────

export interface FolderContents {
  job: BatchJobDetail
  items: BatchItemRow[]          // 何かしらの結果がある写真だけ（並び順）。ctx.items と同じ
  tasks: BatchTaskRow[]
  knownFull: BatchOutputRow[]    // 保存済みのフル解像度（選んだときの再利用）
  ctx: ReviewContext             // 確認グリッドと同じ文脈（reviewStore.sync に渡す）
  columns: FolderColumn[]
  exportParams: ExportParams     // 投入時の Export 設定（バリアントの保存形式に使う）
}

/** 背景が「画像」のバリアントの背景 URL（ジョブごとの生成結果か固定画像）。JobReviewPanel と同じ解決 */
async function resolveBackgroundUrls(canvas: BgCanvas, variants: ReviewVariant[], tasks: BatchTaskRow[], workflowId: string | null): Promise<Record<string, string>> {
  const wanted = variants.filter((v) => v.backgroundNodeId && v.params.backgroundKind === 'image')
  if (!wanted.length) return {}
  const byPath: Record<string, string> = {}, byUrl: Record<string, string> = {}
  for (const v of wanted) {
    const src = resolveBackgroundSource(canvas, v.key)
    if (!src) continue
    if (src.generatorNodeId) {
      const t = tasks.find((x) => x.item_id === null && x.node_id === src.generatorNodeId && x.status === 'completed' && x.result_path)
      if (t?.result_path) byPath[src.sourceNodeId] = t.result_path
    } else {
      const d = canvas.nodes?.find((n) => n.id === src.sourceNodeId)?.data
      const u = typeof d?.output === 'string' ? d.output : typeof d?.imageUrl === 'string' ? d.imageUrl : null
      if (u) byUrl[src.sourceNodeId] = u
    }
  }
  const out: Record<string, string> = {}
  if (Object.keys(byPath).length) { const m = await signMediaRequest({ batchPaths: Object.values(byPath) }); for (const [nid, p] of Object.entries(byPath)) if (m[p]) out[nid] = m[p] }
  if (Object.keys(byUrl).length) { const m = await signMediaRequest({ urls: Object.values(byUrl), workflowId: workflowId ?? undefined }); for (const [nid, u] of Object.entries(byUrl)) if (m[u]) out[nid] = m[u] }
  return out
}

/** フォルダを開いたときの読み込み。列の出どころは確認グリッド（ジョブ管理画面）と同じ: 元ワークフローが読めればその現在のノード、読めなければ投入時の写し */
export async function loadFolderContents(jobId: string): Promise<FolderContents | null> {
  const [job, allItems, tasks] = await Promise.all([fetchJobDetail(jobId), fetchJobItems(jobId), fetchJobTasks(jobId)])
  if (!job) return null
  const itemIds = allItems.map((i) => i.id)
  const [knownThumbs, knownFull, source] = await Promise.all([
    fetchJobOutputs(itemIds, 'thumb').catch(() => [] as BatchOutputRow[]),
    fetchJobOutputs(itemIds, 'full').catch(() => [] as BatchOutputRow[]),
    job.workflow_id ? fetchJobWorkflowSource(job.id, job.workflow_id).catch(() => null) : Promise.resolve(null),
  ])
  const variants = source
    ? variantsFromSnapshot(source.canvas as CanvasLike, { [ADDED_VARIANTS_KEY]: addedVariantsOf(job.layout_overrides) })
    : variantsFromSnapshot(job.workflow_snapshot, job.layout_overrides)
  const canvas = (source?.canvas ?? job.workflow_snapshot) as unknown as BgCanvas
  const cutoutNode = cutoutNodesFromSnapshot(job.workflow_snapshot)[0] ?? null
  const results = resultColumnsOf(tasks, job.workflow_snapshot)
  const backgroundUrls = await resolveBackgroundUrls(canvas, variants, tasks, job.workflow_id).catch(() => ({} as Record<string, string>))
  const base: ReviewContext = {
    teamId: job.team_id, jobId: job.id, items: allItems, tasks, variants, results,
    cutoutNodeId: cutoutNode?.nodeId ?? null, cutoutParams: cutoutNode?.params ?? (normalizeCutoutParams({}) as CutoutParams),
    knownThumbs, backgroundUrls,
  }
  // 最終結果が 1 つも無い写真（失敗・未処理）は出さない
  const items = allItems.filter((it) => !!renderableOf(base, it) || results.some((c) => !!completedResultOf(base, it.id, c.nodeId)))
  return { job, items, tasks, knownFull, ctx: { ...base, items }, columns: folderColumnsOf(!!cutoutNode, variants, results), exportParams: exportParamsFromSnapshot(job.workflow_snapshot) }
}

// ───────────────────────── 選んだタイルを使える画像にする ─────────────────────────

export interface FolderImage {
  path: string                  // batch バケットのパス
  url: string                   // 保存形式の URL（/object/public/batch/<path>。表示・生成時にサーバーで署名）
  signedUrl: string             // 今すぐ表示に使える署名 URL
  name: string
  width: number | null
  height: number | null
}
export interface ResolveProgress { done: number; total: number }

const MIME: Record<ExportFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

/** 選んだタイル（写真 × 列。鍵は thumbKey）を使える画像にする。生成結果の列は結果ファイルそのもの。切り抜き・バリアントの列はフル解像度を描いて保存（同じ識別値なら保存済みを再利用） */
export async function resolveFolderImages(
  contents: FolderContents, store: ReviewStoreApi, keys: string[],
  opts: { onProgress?: (p: ResolveProgress) => void; isCancelled?: () => boolean } = {},
): Promise<{ images: FolderImage[]; warnings: string[]; cancelled: boolean }> {
  const images: FolderImage[] = []
  const warnings: string[] = []
  let done = 0
  for (const k of keys) {
    if (opts.isCancelled?.()) return { images, warnings, cancelled: true }
    const { itemId, key } = parseTileKey(k)
    const item = contents.ctx.items.find((i) => i.id === itemId)
    const col = contents.columns.find((c) => c.key === key)
    if (item && col) {
      try {
        const img = isResultKey(key) ? await resolveResult(contents.ctx, item, col) : await resolveLayout(contents, store, item, col)
        if (img) images.push(img)
        else warnings.push(`${item.sku}（${col.name}）はまだ用意できません`)
      } catch (e) {
        warnings.push(`${item.sku}（${col.name}）: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    done++
    opts.onProgress?.({ done, total: keys.length })
  }
  return { images, warnings, cancelled: false }
}

async function resolveResult(ctx: ReviewContext, item: BatchItemRow, col: FolderColumn): Promise<FolderImage | null> {
  const task = completedResultOf(ctx, item.id, resultNodeIdOf(col.key))
  if (!task) return null
  const signed = await signBatchPath(task.result_path)
  if (!signed) throw new Error('結果画像の署名に失敗しました（チームの権限を確認してください）')
  return { path: task.result_path, url: batchCanonicalUrl(task.result_path), signedUrl: signed, name: folderImageName(item.sku, col.name), width: task.result_meta?.width ?? item.width ?? null, height: task.result_meta?.height ?? item.height ?? null }
}

async function resolveLayout(contents: FolderContents, store: ReviewStoreApi, item: BatchItemRow, col: FolderColumn): Promise<FolderImage | null> {
  const { ctx, knownFull, exportParams } = contents
  const r = renderableOf(ctx, item)
  if (!r) return null
  // 識別値は確認グリッドの同期（sync）が各タイルに付けたもの（レイアウト設定・元画像・切り抜き結果の版から決まる）
  const hash = store.getState().thumbs[thumbKey(item.id, col.key)]?.hash ?? null
  if (!hash) return null
  const name = folderImageName(item.sku, col.name)
  const size = col.kind === 'variant' ? { width: col.width, height: col.height } : { width: item.width ?? null, height: item.height ?? null }
  const known = knownFull.find((o) => o.item_id === item.id && o.variant === col.key && o.layout_hash === hash)
  if (known) {
    const signed = await signBatchPath(known.output_path).catch(() => null)
    if (signed) return { path: known.output_path, url: batchCanonicalUrl(known.output_path), signedUrl: signed, name, ...size }
  }
  const assets = await assetsFor(r)
  const v = ctx.variants.find((x) => x.key === col.key)
  // 保存形式は ZIP 書き出しと同じ（透過は PNG のまま。不透明なバリアントは投入時の Export 設定の形式・品質・上限）
  const encode = v && v.params.backgroundKind !== 'transparent'
    ? { format: exportParams.format, quality: exportParams.jpegQuality, maxBytes: exportParams.maxFileKb ? exportParams.maxFileKb * 1024 : null }
    : null
  const spec = col.key === CUTOUT_VARIANT_KEY || !v
    ? { key: CUTOUT_VARIANT_KEY, params: CUTOUT_PREVIEW_PARAMS, encode: null }
    : { key: v.key, params: v.params, backgroundUrl: v.backgroundNodeId ? ctx.backgroundUrls[v.backgroundNodeId] ?? null : null, encode }
  const holder: { res: FullResult | null } = { res: null }
  await store.getState().getExecutor().renderFull({ assets, cutout: r.cutout, variants: [spec] }, (res) => { holder.res = res })
  const res = holder.res
  if (!res) throw new Error('描画結果がありません')
  const path = `${ctx.teamId}/${ctx.jobId}/${item.id}/${fullFileName(col.key, hash, res.format)}`
  await uploadBatchObjectIfMissing(path, res.blob, MIME[res.format])
  await recordOutput(item.id, col.key, hash, path, 'full').catch((e) => console.warn('[folder] full output record failed:', e))
  knownFull.push({ id: '', item_id: item.id, team_id: ctx.teamId, variant: col.key, layout_hash: hash, output_path: path, executor: 'browser', kind: 'full', created_at: new Date().toISOString() })
  const signed = await signBatchPath(path)
  if (!signed) throw new Error('保存した画像の署名に失敗しました')
  return { path, url: batchCanonicalUrl(path), signedUrl: signed, name, ...size }
}
