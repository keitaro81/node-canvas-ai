// バッチ投入・Webhook・照合の共有コア（仕様 4-2 / 4-5 / 4-6 / 4-7）。
// Edge（api/batch/*.ts）と vite dev（/dev-proxy/batch/*）が同じ関数を呼ぶ。DB 書き込みは service role。
// 完了/失敗の反映は必ず finalizeTask() → RPC apply_batch_task_result（Step 1・冪等）を通す。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { appRootOf, isAllowedTarget } from '../fal/_allowlist'
import { buildEngineRequest, normalizeCutoutParams, pickEngineResult } from '../../src/lib/cutout/engines'
import type { CutoutEngine } from '../../src/types/nodes'
import { estimatePlannedTaskCost, estimateTaskCost } from './_pricing'
import { verifyFalWebhook, type FalWebhookBody, type WebCryptoKey } from './_falWebhook'
import { jstDayRangeUtc, jstDateTimeLabel } from '../../src/lib/batch/dates'

export const BATCH_BUCKET = 'batch'
export const MAX_ITEMS_PER_JOB = 50
export const MAX_ACTIVE_JOBS = 2
export const DEFAULT_DAILY_ITEM_LIMIT = 300
export const SUBMIT_CHUNK = 10
export const RECONCILE_MIN_AGE_SEC = 600
export const RESULT_EXPIRY_SEC = 60 * 60          // fal の結果保持（Webhook 再送の記述から推定: 完了後およそ 1 時間）
export const MAX_ATTEMPTS = 2
export const SIGNED_URL_TTL = 24 * 60 * 60

type Admin = any
export interface BatchResult { status: number; body: Record<string, unknown> }
const ok = (body: Record<string, unknown>): BatchResult => ({ status: 200, body })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): BatchResult => ({ status, body: { error, ...extra } })

export interface BatchOpts {
  falKey: string
  webhookBaseUrl: string | null   // 例 https://node-canvas-ai.vercel.app（null = Webhook なし → 照合で回収）
  isAdmin: boolean                // 運営 allowlist（Webhook 無効化フラグの利用可否）
}

// ───────────────────────── 日付（JST）: src/lib/batch/dates.ts と共有 ─────────────────────────

export { jstDayRangeUtc, jstDateTimeLabel }

// ───────────────────────── 所属 ─────────────────────────

export async function memberOf(admin: Admin, userId: string): Promise<{ teamId: string; role: string } | null> {
  const { data } = await admin.from('team_members').select('team_id, role').eq('user_id', userId).limit(1).maybeSingle()
  return data?.team_id ? { teamId: data.team_id as string, role: (data.role as string) ?? 'member' } : null
}

// ───────────────────────── ワークフローの写し → タスク計画 ─────────────────────────

export interface SnapshotNode { id: string; type?: string; data?: any }
export interface SnapshotEdge { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }
export interface WorkflowSnapshot { nodes?: SnapshotNode[]; edges?: SnapshotEdge[] }

export interface PlannedTask {
  nodeId: string
  scope: 'item' | 'job'
  endpoint: string
  input: Record<string, unknown>   // アイテムごとのタスクは image_url を投入時に足す
  kind: 'cutout' | 'imageGen'
}

/**
 * 写しから AI 処理ノードを抽出する（仕様 4-2）。
 * - Remove Background（Batch Input に直結しているもの）→ アイテムごとのタスク
 * - Image Generation で executionScope='job' → ジョブごとのタスク（背景生成。Step 8 で入力を仕上げる）
 */
export function planTasks(snapshot: WorkflowSnapshot | null | undefined): { tasks: PlannedTask[]; warnings: string[] } {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot!.nodes! : []
  const edges = Array.isArray(snapshot?.edges) ? snapshot!.edges! : []
  const batchInputIds = new Set(nodes.filter((n) => n?.data?.type === 'batchInput').map((n) => n.id))
  const tasks: PlannedTask[] = []
  const warnings: string[] = []
  for (const node of nodes) {
    const t = node?.data?.type
    if (t === 'removeBackground') {
      const feed = edges.find((e) => e.target === node.id && e.targetHandle === 'in-image-image')
      if (!feed || !batchInputIds.has(feed.source)) {
        warnings.push(`Remove Background（${node.id}）は Batch Input に接続されていないため一括実行の対象外です`)
        continue
      }
      const req = buildEngineRequest(normalizeCutoutParams(node.data?.params), '__IMAGE_URL__')
      const input: Record<string, unknown> = { ...req.input }
      delete input.image_url
      tasks.push({ nodeId: node.id, scope: 'item', endpoint: req.endpoint, input, kind: 'cutout' })
    } else if (t === 'imageGen' && node?.data?.params?.executionScope === 'job') {
      const p = node.data.params as Record<string, unknown>
      const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : ''
      if (!prompt) {
        warnings.push(`Image Generation（${node.id}）はプロンプトが空のため一括実行の対象外です`)
        continue
      }
      tasks.push({ nodeId: node.id, scope: 'job', endpoint: String(p.model ?? 'fal-ai/nano-banana-2'), input: { prompt, image_size: 'square_hd' }, kind: 'imageGen' })
    }
  }
  return { tasks, warnings }
}

// ───────────────────────── 上限（4-7・純関数） ─────────────────────────

export interface LimitInputs { dailyLimit: number; usedToday: number; activeJobs: number; newItems: number }
export type LimitCheck = { ok: true } | { ok: false; code: string; status: number; message: string }

export function checkLimits(l: LimitInputs): LimitCheck {
  if (l.newItems < 1) return { ok: false, code: 'no_items', status: 400, message: '画像がありません' }
  if (l.newItems > MAX_ITEMS_PER_JOB) return { ok: false, code: 'items_limit', status: 400, message: `1 ジョブは ${MAX_ITEMS_PER_JOB} 枚までです（${l.newItems} 枚）` }
  if (l.activeJobs >= MAX_ACTIVE_JOBS) return { ok: false, code: 'active_jobs', status: 429, message: `同時に進行できるジョブは ${MAX_ACTIVE_JOBS} つまでです` }
  if (l.usedToday + l.newItems > l.dailyLimit) return { ok: false, code: 'daily_limit', status: 429, message: `本日の上限 ${l.dailyLimit} 枚を超えます（本日 ${l.usedToday} 枚 + ${l.newItems} 枚）` }
  return { ok: true }
}

// ───────────────────────── 保存パス ─────────────────────────

export function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path)
  const e = (m?.[1] ?? 'jpg').toLowerCase()
  return e === 'jpeg' ? 'jpg' : e
}
export function originalPath(teamId: string, jobId: string, itemId: string, srcPath: string): string {
  return `${teamId}/${jobId}/${itemId}/original.${extOf(srcPath)}`
}
export function resultPath(task: { team_id: string; job_id: string; item_id: string | null; node_id: string }, contentType: string): string {
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
  return `${task.team_id}/${task.job_id}/${task.item_id ?? 'job'}/${task.node_id}-result.${ext}`
}

// ───────────────────────── fal HTTP ─────────────────────────

async function falFetch(falKey: string, method: string, url: string, body?: unknown): Promise<Response> {
  if (!isAllowedTarget(new URL(url))) throw new Error(`fal target not allowed: ${url}`)
  return fetch(url, {
    method,
    headers: { Authorization: `Key ${falKey}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export async function falSubmit(falKey: string, endpoint: string, input: Record<string, unknown>, webhookUrl?: string): Promise<{ requestId: string } | { error: string }> {
  const url = `https://queue.fal.run/${endpoint}${webhookUrl ? `?fal_webhook=${encodeURIComponent(webhookUrl)}` : ''}`
  try {
    const res = await falFetch(falKey, 'POST', url, input)
    const text = await res.text()
    if (!res.ok) return { error: `fal submit ${res.status}: ${text.slice(0, 200)}` }
    const j = JSON.parse(text) as { request_id?: string }
    if (!j.request_id) return { error: 'fal submit: no request_id' }
    return { requestId: j.request_id }
  } catch (e) {
    return { error: `fal submit failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export interface FalStatusResult { httpStatus: number; status?: string; error?: string; inferenceTime?: number | null }

export async function falStatus(falKey: string, endpoint: string, requestId: string): Promise<FalStatusResult> {
  const res = await falFetch(falKey, 'GET', `https://queue.fal.run/${appRootOf(endpoint)}/requests/${requestId}/status`)
  const j = await res.json().catch(() => ({})) as { status?: string; error?: string; metrics?: { inference_time?: number } }
  return { httpStatus: res.status, status: j.status, error: j.error, inferenceTime: j.metrics?.inference_time ?? null }
}

export async function falResponse(falKey: string, endpoint: string, requestId: string): Promise<{ ok: boolean; httpStatus: number; payload?: unknown }> {
  // 結果は …/requests/<id>（fal SDK の queue.result と同じ。/response は 405 になる）
  const res = await falFetch(falKey, 'GET', `https://queue.fal.run/${appRootOf(endpoint)}/requests/${requestId}`)
  if (!res.ok) return { ok: false, httpStatus: res.status }
  return { ok: true, httpStatus: res.status, payload: await res.json().catch(() => null) }
}

export async function falCancel(falKey: string, endpoint: string, requestId: string): Promise<boolean> {
  try {
    const res = await falFetch(falKey, 'PUT', `https://queue.fal.run/${appRootOf(endpoint)}/requests/${requestId}/cancel`)
    return res.ok
  } catch { return false }
}

// ───────────────────────── create ─────────────────────────

export interface CreateItemInput { index: number; originalName: string; sku: string; interactivePath: string; width?: number; height?: number }
export interface CreateBody { name?: string; items?: CreateItemInput[]; workflowSnapshot?: WorkflowSnapshot; dryRun?: boolean; workflowId?: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 投入元ワークフロー: 本人のプロジェクトのもの、または同じチームに共有されたものだけ記録する（それ以外は null） */
async function resolveSourceWorkflow(admin: Admin, userId: string, teamId: string, workflowId: unknown): Promise<string | null> {
  if (typeof workflowId !== 'string' || !UUID_RE.test(workflowId)) return null
  const { data: wf } = await admin.from('workflows').select('id, project_id, team_id, visibility').eq('id', workflowId).maybeSingle()
  if (!wf) return null
  const { data: project } = await admin.from('projects').select('user_id').eq('id', wf.project_id).maybeSingle()
  if (project?.user_id === userId) return wf.id
  if (wf.team_id === teamId && (wf.visibility === 'team' || wf.visibility === 'public')) return wf.id
  return null
}

export async function batchCreate(admin: Admin, userId: string, body: CreateBody): Promise<BatchResult> {
  const m = await memberOf(admin, userId)
  if (!m) return fail(403, 'not_a_member', { message: 'チームに所属していません' })
  const items = Array.isArray(body?.items) ? body.items : []
  for (const it of items) {
    if (!it || typeof it.originalName !== 'string' || typeof it.sku !== 'string' || typeof it.interactivePath !== 'string') return fail(400, 'invalid_item')
    if (!it.interactivePath.startsWith(`${m.teamId}/`)) return fail(400, 'invalid_item_path', { message: '他チームのファイルは使えません' })
  }

  const { data: team } = await admin.from('teams').select('daily_item_limit, show_cost').eq('id', m.teamId).maybeSingle()
  const dailyLimit = typeof team?.daily_item_limit === 'number' ? team.daily_item_limit : DEFAULT_DAILY_ITEM_LIMIT
  const { start, end } = jstDayRangeUtc()
  const { data: todayJobs } = await admin.from('batch_jobs').select('item_count, status').eq('team_id', m.teamId).gte('created_at', start).lt('created_at', end)
  const usedToday = ((todayJobs ?? []) as Array<{ item_count: number; status: string }>).filter((j) => j.status !== 'cancelled').reduce((s, j) => s + (j.item_count ?? 0), 0)
  const { count: activeJobs } = await admin.from('batch_jobs').select('id', { count: 'exact', head: true }).eq('team_id', m.teamId).in('status', ['uploading', 'submitted', 'processing'])

  const plan = planTasks(body?.workflowSnapshot)
  const itemTasks = plan.tasks.filter((t) => t.scope === 'item')
  const jobTasks = plan.tasks.filter((t) => t.scope === 'job')
  const estimatedCostUsd = Math.round((items.length * itemTasks.reduce((s, t) => s + estimatePlannedTaskCost(t.endpoint), 0) + jobTasks.reduce((s, t) => s + estimatePlannedTaskCost(t.endpoint), 0)) * 10000) / 10000
  const limits = { dailyLimit, usedToday, remaining: Math.max(0, dailyLimit - usedToday), activeJobs: activeJobs ?? 0, maxActiveJobs: MAX_ACTIVE_JOBS, maxItemsPerJob: MAX_ITEMS_PER_JOB }
  const planInfo = {
    itemTasks: itemTasks.length, jobTasks: jobTasks.length, totalTasks: items.length * itemTasks.length + jobTasks.length,
    estimatedCostUsd, estimatedSeconds: Math.ceil(items.length * 2 + jobTasks.length * 10), showCost: !!team?.show_cost, warnings: plan.warnings,
  }
  if (body?.dryRun) return ok({ limits, plan: planInfo })

  const chk = checkLimits({ dailyLimit, usedToday, activeJobs: activeJobs ?? 0, newItems: items.length })
  if (!chk.ok) return fail(chk.status, chk.code, { message: chk.message, limits })
  if (plan.tasks.length === 0) return fail(400, 'no_tasks', { message: '一括実行の対象となる AI 処理ノード（Batch Input に接続した Remove Background 等）がありません', warnings: plan.warnings })

  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : `${jstDateTimeLabel()} ${items.length}枚`
  const workflowId = await resolveSourceWorkflow(admin, userId, m.teamId, body.workflowId)
  const { data: job, error: jobErr } = await admin.from('batch_jobs').insert({
    team_id: m.teamId, created_by: userId, name, workflow_snapshot: body.workflowSnapshot ?? {}, status: 'uploading',
    item_count: items.length, task_count: planInfo.totalTasks, estimated_cost_usd: estimatedCostUsd, workflow_id: workflowId,
  }).select('id, webhook_secret').single()
  if (jobErr || !job) return fail(500, 'job_insert_failed', { message: jobErr?.message })

  const rows = items.map((it, i) => ({
    job_id: job.id, team_id: m.teamId, sort_order: Number.isInteger(it.index) ? it.index : i + 1,
    original_filename: it.originalName, sku: it.sku, interactive_path: it.interactivePath,
    width: it.width ?? null, height: it.height ?? null, status: 'pending',
  }))
  const { data: inserted, error: itemErr } = await admin.from('batch_items').insert(rows).select('id, sort_order')
  if (itemErr) {
    await admin.from('batch_jobs').delete().eq('id', job.id)
    return fail(500, 'items_insert_failed', { message: itemErr.message })
  }
  return ok({ jobId: job.id, itemIds: (inserted ?? []).map((r: any) => r.id), limits, plan: planInfo })
}

// ───────────────────────── submit ─────────────────────────

export interface SubmitBody { jobId?: string; disableWebhook?: boolean; chunk?: number }

function webhookUrlFor(opts: BatchOpts, job: { id: string; webhook_secret: string }, disable: boolean): string | undefined {
  if (disable || !opts.webhookBaseUrl) return undefined
  return `${opts.webhookBaseUrl.replace(/\/$/, '')}/api/batch/webhook?job=${job.id}&secret=${encodeURIComponent(job.webhook_secret)}`
}

async function signOriginal(admin: Admin, path: string): Promise<string | null> {
  const { data } = await admin.storage.from(BATCH_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  return data?.signedUrl ?? null
}

export async function batchSubmit(admin: Admin, userId: string, opts: BatchOpts, body: SubmitBody): Promise<BatchResult> {
  const m = await memberOf(admin, userId)
  if (!m) return fail(403, 'not_a_member')
  if (!body?.jobId) return fail(400, 'job_id_required')
  if (body.disableWebhook && !opts.isAdmin) return fail(403, 'operator_only', { message: 'Webhook 無効化は運営専用です' })
  const { data: job } = await admin.from('batch_jobs').select('*').eq('id', body.jobId).eq('team_id', m.teamId).maybeSingle()
  if (!job) return fail(404, 'job_not_found')
  if (['cancelled', 'completed', 'partial_failed'].includes(job.status)) return fail(409, 'job_not_submittable', { status: job.status })
  const chunk = Math.min(25, Math.max(1, Number(body.chunk) || SUBMIT_CHUNK))
  const plan = planTasks(job.workflow_snapshot)
  const { data: itemsData } = await admin.from('batch_items').select('*').eq('job_id', job.id).order('sort_order')
  const items = (itemsData ?? []) as any[]

  // 1) 元画像をジョブ階層へコピー（Batch Input の対話用アップロードから。冪等）
  let copied = 0
  const copyFailures: string[] = []
  for (const it of items.filter((i) => !i.source_path && i.interactive_path && i.status !== 'failed').slice(0, chunk)) {
    const dest = originalPath(job.team_id, job.id, it.id, it.interactive_path)
    const { error } = await admin.storage.from(BATCH_BUCKET).copy(it.interactive_path, dest)
    if (error && !/already exists|duplicate/i.test(String(error.message))) {
      copyFailures.push(`${it.original_filename}: ${error.message}`)
      await admin.from('batch_items').update({ status: 'failed', warnings: [`元画像のコピーに失敗: ${error.message}`], updated_at: new Date().toISOString() }).eq('id', it.id)
      it.status = 'failed'
      continue
    }
    await admin.from('batch_items').update({ source_path: dest, updated_at: new Date().toISOString() }).eq('id', it.id)
    it.source_path = dest
    copied++
  }

  // 2) タスクを作る（(job, node, item) の一意索引 + ignoreDuplicates で再実行しても二重に作らない）
  const { data: existingData } = await admin.from('batch_tasks').select('id, node_id, item_id, status').eq('job_id', job.id)
  const existing = new Set(((existingData ?? []) as any[]).map((t) => `${t.node_id}|${t.item_id ?? ''}`))
  const newRows: any[] = []
  for (const t of plan.tasks) {
    if (t.scope === 'item') {
      for (const it of items) {
        if (!it.source_path || it.status === 'failed') continue
        if (existing.has(`${t.nodeId}|${it.id}`)) continue
        newRows.push({ job_id: job.id, item_id: it.id, team_id: job.team_id, node_id: t.nodeId, endpoint: t.endpoint, input: { ...t.input, __kind: t.kind }, status: 'pending' })
      }
    } else if (!existing.has(`${t.nodeId}|`)) {
      newRows.push({ job_id: job.id, item_id: null, team_id: job.team_id, node_id: t.nodeId, endpoint: t.endpoint, input: { ...t.input, __kind: t.kind }, status: 'pending' })
    }
  }
  let tasksCreated = 0
  if (newRows.length) {
    const { data: ins, error } = await admin.from('batch_tasks').upsert(newRows, { onConflict: 'job_id,node_id,item_id', ignoreDuplicates: true }).select('id')
    if (error) return fail(500, 'task_insert_failed', { message: error.message })
    tasksCreated = (ins ?? []).length
  }

  // 3) 未投入タスクを fal キューへ（チャンク）
  const { data: pendingData } = await admin.from('batch_tasks').select('*').eq('job_id', job.id).eq('status', 'pending').order('created_at').limit(chunk)
  const webhook = webhookUrlFor(opts, job, !!body.disableWebhook)
  let submitted = 0, failedSubmits = 0
  for (const task of (pendingData ?? []) as any[]) {
    const input = falInputOf(task)
    if (task.item_id) {
      const it = items.find((i) => i.id === task.item_id)
      if (!it?.source_path) continue
      const signed = await signOriginal(admin, it.source_path)
      if (!signed) continue
      input.image_url = signed
    }
    // 投入権を取る（attempts の CAS）。再開・失敗分の再実行が別のブラウザから同時に走っても同じタスクを二重に投入しない
    const attempts = (task.attempts ?? 0) + 1
    const { data: claimed } = await admin.from('batch_tasks').update({ attempts }).eq('id', task.id).eq('status', 'pending').eq('attempts', task.attempts ?? 0).select('id')
    if (!claimed?.length) continue
    const r = await falSubmit(opts.falKey, task.endpoint, input, webhook)
    if ('requestId' in r) {
      await admin.from('batch_tasks').update({ status: 'submitted', fal_request_id: r.requestId, submitted_at: new Date().toISOString(), error: null }).eq('id', task.id)
      if (task.item_id) await admin.from('batch_items').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', task.item_id).eq('status', 'pending')
      submitted++
    } else {
      failedSubmits++
      if (attempts >= MAX_ATTEMPTS) {
        await admin.rpc('apply_batch_task_result', { p_task_id: task.id, p_outcome: 'failed', p_error: r.error })
      } else {
        await admin.from('batch_tasks').update({ error: r.error }).eq('id', task.id)
      }
    }
  }

  // 4) ジョブの記帳
  const { data: allTasks } = await admin.from('batch_tasks').select('status').eq('job_id', job.id)
  const statuses = ((allTasks ?? []) as Array<{ status: string }>).map((t) => t.status)
  const pendingTasks = statuses.filter((s) => s === 'pending').length
  const pendingCopies = items.filter((i) => !i.source_path && i.status !== 'failed').length
  const done = pendingCopies === 0 && pendingTasks === 0 && statuses.length > 0
  const patch: Record<string, unknown> = { task_count: statuses.length, updated_at: new Date().toISOString() }
  if (done && job.status === 'uploading') patch.status = 'submitted'
  await admin.from('batch_jobs').update(patch).eq('id', job.id)
  const { data: fresh } = await admin.from('batch_jobs').select('status').eq('id', job.id).maybeSingle()

  return ok({
    jobId: job.id, copied, copyFailures, tasksCreated, submitted, failedSubmits, pendingCopies, pendingTasks,
    totalTasks: statuses.length, done, jobStatus: fresh?.status ?? job.status, webhook: !!webhook, warnings: plan.warnings,
  })
}

/** タスクの input から fal に送る分だけを取り出す（`__kind` / `__params` などの内部用キーは送らない） */
export function falInputOf(task: { input?: Record<string, unknown> | null }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(task.input ?? {})) if (!k.startsWith('__')) out[k] = v
  return out
}

// ───────────────────────── 反映（1 か所） ─────────────────────────

export type TaskOutcome = { ok: true; payload: unknown; inferenceTime?: number | null } | { ok: false; error: string }

function engineOfEndpoint(endpoint: string): CutoutEngine | null {
  if (endpoint.startsWith('fal-ai/birefnet')) return 'birefnet'
  if (endpoint.startsWith('fal-ai/bria/background/remove')) return 'bria'
  return null
}

/** fal の出力 JSON から保存すべきファイルを選ぶ（切り抜き = マスク / 画像生成 = 1 枚目）。 */
export function pickResultFile(endpoint: string, payload: unknown): { url: string; kind: string; width?: number; height?: number } | null {
  const engine = engineOfEndpoint(endpoint)
  if (engine) {
    try { const f = pickEngineResult(engine, payload); return { url: f.url, kind: f.kind, width: f.width, height: f.height } } catch { return null }
  }
  const p = (payload && typeof payload === 'object' ? payload : {}) as { images?: Array<{ url?: string; width?: number; height?: number }>; image?: { url?: string; width?: number; height?: number } }
  const img = p.images?.[0] ?? p.image
  return img?.url ? { url: img.url, kind: 'image', width: img.width, height: img.height } : null
}

/**
 * タスクの完了/失敗を反映する（Webhook・照合・再投入失敗の全経路がここを通る）。
 * 成功: 結果ファイルをそのままコピー（展開・加工なし）→ RPC completed。失敗: 試行 2 回未満なら再投入、以上なら RPC failed。
 */
export async function finalizeTask(admin: Admin, opts: BatchOpts, taskId: string, outcome: TaskOutcome, disableWebhook = false): Promise<{ action: string; applied: boolean }> {
  const { data: task } = await admin.from('batch_tasks').select('*').eq('id', taskId).maybeSingle()
  if (!task) return { action: 'missing', applied: false }
  if (task.status !== 'submitted') return { action: `skip_${task.status}`, applied: false }

  if (outcome.ok) {
    const file = pickResultFile(task.endpoint, outcome.payload)
    if (!file) {
      const applied = await admin.rpc('apply_batch_task_result', { p_task_id: task.id, p_outcome: 'failed', p_error: 'fal の応答に結果ファイルがありません' })
      return { action: 'failed_no_result', applied: !!applied.data }
    }
    const res = await fetch(file.url).catch(() => null)
    if (!res || !res.ok) return { action: 'result_fetch_failed', applied: false }   // submitted のまま → 照合で再取得
    const contentType = res.headers.get('content-type') ?? 'image/png'
    const dest = resultPath(task, contentType)
    const buf = await res.arrayBuffer()
    const { error: upErr } = await admin.storage.from(BATCH_BUCKET).upload(dest, buf, { contentType, upsert: true })
    if (upErr) return { action: 'result_store_failed', applied: false }
    const meta = { kind: file.kind, width: file.width ?? null, height: file.height ?? null, contentType, bytes: buf.byteLength, inferenceTime: outcome.inferenceTime ?? null, falRequestId: task.fal_request_id }
    const cost = estimateTaskCost(task.endpoint, outcome.inferenceTime ?? null)
    const { data: applied } = await admin.rpc('apply_batch_task_result', { p_task_id: task.id, p_outcome: 'completed', p_result_path: dest, p_result_meta: meta, p_cost_usd: cost })
    return { action: 'completed', applied: !!applied }
  }

  // 失敗
  if ((task.attempts ?? 0) < MAX_ATTEMPTS) {
    const input = falInputOf(task)
    if (task.item_id) {
      const { data: it } = await admin.from('batch_items').select('source_path').eq('id', task.item_id).maybeSingle()
      const signed = it?.source_path ? await signOriginal(admin, it.source_path) : null
      if (!signed) {
        const { data: applied } = await admin.rpc('apply_batch_task_result', { p_task_id: task.id, p_outcome: 'failed', p_error: '再投入に必要な元画像がありません' })
        return { action: 'failed', applied: !!applied }
      }
      input.image_url = signed
    }
    const { data: job } = await admin.from('batch_jobs').select('id, webhook_secret').eq('id', task.job_id).maybeSingle()
    const r = await falSubmit(opts.falKey, task.endpoint, input, job ? webhookUrlFor(opts, job, disableWebhook) : undefined)
    if ('requestId' in r) {
      await admin.from('batch_tasks').update({ fal_request_id: r.requestId, submitted_at: new Date().toISOString(), attempts: (task.attempts ?? 0) + 1, error: outcome.error }).eq('id', task.id)
      return { action: 'resubmitted', applied: true }
    }
    const { data: applied } = await admin.rpc('apply_batch_task_result', { p_task_id: task.id, p_outcome: 'failed', p_error: `${outcome.error} / 再投入失敗: ${r.error}` })
    return { action: 'failed', applied: !!applied }
  }
  const { data: applied } = await admin.rpc('apply_batch_task_result', { p_task_id: task.id, p_outcome: 'failed', p_error: outcome.error })
  return { action: 'failed', applied: !!applied }
}

// ───────────────────────── webhook ─────────────────────────

export interface WebhookContext { waitUntil?: (p: Promise<unknown>) => void }

/** fal からの通知。ジョブ秘密値 + fal 署名 + request_id の所属を検証し、すぐ応答してから反映する。 */
export async function handleFalWebhook(admin: Admin, opts: BatchOpts & { keys: WebCryptoKey[] }, req: Request, ctx: WebhookContext): Promise<Response> {
  const json = (body: object, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const url = new URL(req.url)
  const jobId = url.searchParams.get('job')
  const secret = url.searchParams.get('secret')
  if (!jobId || !secret) return json({ error: 'bad request' }, 400)
  const rawBody = await req.text()
  if (rawBody.length > 2_000_000) return json({ error: 'payload too large' }, 413)
  const v = await verifyFalWebhook(req.headers, rawBody, { keys: opts.keys })
  if (!v.ok) return json({ error: `invalid signature: ${v.reason}` }, 401)
  let body: FalWebhookBody
  try { body = JSON.parse(rawBody) } catch { return json({ error: 'invalid json' }, 400) }
  if (body.request_id !== v.requestId) return json({ error: 'request id mismatch' }, 401)
  const { data: job } = await admin.from('batch_jobs').select('id, webhook_secret').eq('id', jobId).maybeSingle()
  if (!job || job.webhook_secret !== secret) return json({ error: 'unknown job' }, 401)
  const { data: task } = await admin.from('batch_tasks').select('id, endpoint, status').eq('job_id', jobId).eq('fal_request_id', body.request_id).maybeSingle()
  if (!task) return json({ error: 'task not registered yet' }, 409)   // 投入直後の競合: 2xx 以外を返して fal に再送させる
  if (task.status !== 'submitted') return json({ ok: true, ignored: task.status }, 200)

  const work = (async () => {
    let outcome: TaskOutcome
    if (body.status === 'OK') {
      let payload = body.payload
      if (payload == null) {
        // payload_error（直列化できない大きさ等）: 結果 URL から取り直す
        const r = await falResponse(opts.falKey, task.endpoint, body.request_id!)
        payload = r.ok ? r.payload : null
      }
      outcome = payload == null ? { ok: false, error: body.payload_error ?? 'no payload' } : { ok: true, payload, inferenceTime: null }
    } else {
      outcome = { ok: false, error: body.error ?? body.payload_error ?? 'fal error' }
    }
    await finalizeTask(admin, opts, task.id, outcome)
  })().catch((e) => console.error('[batch-webhook] finalize failed:', e))
  if (ctx.waitUntil) ctx.waitUntil(work)
  else await work
  return json({ ok: true }, 200)
}

// ───────────────────────── reconcile ─────────────────────────

export interface ReconcileBody { jobId?: string; minAgeSec?: number; limit?: number }

export async function batchReconcile(admin: Admin, userId: string, opts: BatchOpts, body: ReconcileBody): Promise<BatchResult> {
  const m = await memberOf(admin, userId)
  if (!m) return fail(403, 'not_a_member')
  const minAge = typeof body?.minAgeSec === 'number' && body.minAgeSec >= 0 ? body.minAgeSec : RECONCILE_MIN_AGE_SEC
  const cutoff = new Date(Date.now() - minAge * 1000).toISOString()
  let q = admin.from('batch_tasks').select('*').eq('team_id', m.teamId).eq('status', 'submitted').lte('submitted_at', cutoff).order('submitted_at').limit(Math.min(100, Math.max(1, Number(body?.limit) || 50)))
  if (body?.jobId) q = q.eq('job_id', body.jobId)
  const { data: tasks } = await q
  const counts = { checked: 0, completed: 0, failed: 0, resubmitted: 0, pending: 0, skipped: 0 }
  for (const task of (tasks ?? []) as any[]) {
    counts.checked++
    if (!task.fal_request_id) { counts.skipped++; continue }
    const ageSec = (Date.now() - new Date(task.submitted_at).getTime()) / 1000
    const st = await falStatus(opts.falKey, task.endpoint, task.fal_request_id)
    let r: { action: string } | null = null
    if (st.httpStatus === 404 || st.httpStatus === 422) {
      if (ageSec > RESULT_EXPIRY_SEC) r = await finalizeTask(admin, opts, task.id, { ok: false, error: `fal に該当リクエストがありません (${st.httpStatus})` })
      else { counts.skipped++; continue }
    } else if (st.status === 'COMPLETED') {
      if (st.error) r = await finalizeTask(admin, opts, task.id, { ok: false, error: st.error })
      else {
        const resp = await falResponse(opts.falKey, task.endpoint, task.fal_request_id)
        if (resp.ok) r = await finalizeTask(admin, opts, task.id, { ok: true, payload: resp.payload, inferenceTime: st.inferenceTime ?? null })
        else if (ageSec > RESULT_EXPIRY_SEC) r = await finalizeTask(admin, opts, task.id, { ok: false, error: '結果の保持期限が切れました' })
        else { counts.skipped++; continue }
      }
    } else { counts.pending++; continue }
    if (r?.action === 'completed') counts.completed++
    else if (r?.action === 'resubmitted') counts.resubmitted++
    else if (r?.action.startsWith('failed')) counts.failed++
    else counts.skipped++
  }
  return ok(counts)
}

// ───────────────────────── retry（失敗分の再実行・仕様 4-11） ─────────────────────────

export interface RetryPlan { taskIds: string[]; itemIds: string[] }

/**
 * 失敗タスクを未投入へ戻す計画（純関数）。
 * 失敗アイテムのうち、失敗の原因が（自分の or ジョブごとの）失敗タスクであるものは待機へ戻す。
 * 元画像のコピー失敗などタスクを持たない失敗アイテムは対象外（再実行では直らない）。
 */
export function planRetry(tasks: Array<{ id: string; item_id: string | null; status: string }>, items: Array<{ id: string; status: string }>): RetryPlan {
  const failed = tasks.filter((t) => t.status === 'failed')
  const taskIds = failed.map((t) => t.id)
  const itemIds = items
    .filter((i) => i.status === 'failed' && failed.some((t) => t.item_id === i.id || t.item_id === null))
    .map((i) => i.id)
  return { taskIds, itemIds }
}

/**
 * 失敗タスクを pending に戻し、ジョブを処理中へ戻す。投入そのものは呼び出し側が batch-submit（冪等・チャンク）で行う。
 * 枚数は同じジョブなので日次上限には二重に数えない。完了済みジョブを再び進行中にするため、同時進行数だけ検査する。
 */
export async function batchRetryFailed(admin: Admin, userId: string, _opts: BatchOpts, body: { jobId?: string }): Promise<BatchResult> {
  const m = await memberOf(admin, userId)
  if (!m) return fail(403, 'not_a_member')
  if (!body?.jobId) return fail(400, 'job_id_required')
  const { data: job } = await admin.from('batch_jobs').select('id, team_id, status, failed_tasks').eq('id', body.jobId).eq('team_id', m.teamId).maybeSingle()
  if (!job) return fail(404, 'job_not_found')
  if (job.status === 'completed') return ok({ jobId: job.id, retriedTasks: 0, resetItems: 0, status: job.status })   // 失敗が無い＝何もしない
  if (!['partial_failed', 'processing', 'submitted'].includes(job.status)) return fail(409, 'job_not_retryable', { status: job.status, message: 'このジョブは再実行できません' })
  const { data: tasks } = await admin.from('batch_tasks').select('id, item_id, status').eq('job_id', job.id)
  const { data: items } = await admin.from('batch_items').select('id, status').eq('job_id', job.id)
  const plan = planRetry((tasks ?? []) as any[], (items ?? []) as any[])
  if (!plan.taskIds.length) return ok({ jobId: job.id, retriedTasks: 0, resetItems: 0, status: job.status })
  if (job.status === 'partial_failed') {
    const { count } = await admin.from('batch_jobs').select('id', { count: 'exact', head: true }).eq('team_id', m.teamId).in('status', ['uploading', 'submitted', 'processing'])
    if ((count ?? 0) >= MAX_ACTIVE_JOBS) return fail(429, 'active_jobs', { message: `同時に進行できるジョブは ${MAX_ACTIVE_JOBS} つまでです` })
  }
  const now = new Date().toISOString()
  await admin.from('batch_tasks').update({ status: 'pending', attempts: 0, error: null, fal_request_id: null, submitted_at: null, completed_at: null }).in('id', plan.taskIds)
  if (plan.itemIds.length) await admin.from('batch_items').update({ status: 'pending', updated_at: now }).in('id', plan.itemIds)
  await admin.from('batch_jobs').update({ status: 'processing', failed_tasks: 0, updated_at: now }).eq('id', job.id)
  return ok({ jobId: job.id, retriedTasks: plan.taskIds.length, resetItems: plan.itemIds.length, status: 'processing' })
}

// ───────────────────────── rerun（NG のみ再実行・仕様 5 章） ─────────────────────────

export interface RerunPlan { taskIds: string[]; itemIds: string[]; skipped: Array<{ itemId: string; reason: string }> }

/**
 * 指定アイテムの、指定ノードのタスクを新しい設定でやり直す計画（純関数）。
 * 終了済み（completed / failed）のタスクだけが対象。投入中（pending / submitted）のものは飛ばす。
 */
export function planRerun(
  tasks: Array<{ id: string; item_id: string | null; node_id: string; status: string }>,
  jobItemIds: string[],
  nodeId: string,
  itemIds: string[],
): RerunPlan {
  const inJob = new Set(jobItemIds)
  const plan: RerunPlan = { taskIds: [], itemIds: [], skipped: [] }
  for (const itemId of Array.from(new Set(itemIds))) {
    if (!inJob.has(itemId)) { plan.skipped.push({ itemId, reason: 'not_in_job' }); continue }
    const t = tasks.find((x) => x.item_id === itemId && x.node_id === nodeId)
    if (!t) { plan.skipped.push({ itemId, reason: 'no_task' }); continue }
    if (t.status !== 'completed' && t.status !== 'failed') { plan.skipped.push({ itemId, reason: `task_${t.status}` }); continue }
    plan.taskIds.push(t.id)
    plan.itemIds.push(itemId)
  }
  return plan
}

export interface RerunBody { jobId?: string; nodeId?: string; itemIds?: string[]; params?: unknown }

/**
 * NG のみ再実行: 対象アイテムの切り抜きタスクを、エンジン/パラメータを差し替えて未投入に戻す（投入は batch-submit で続ける）。
 * 新しいパラメータは task.input.__params に持たせ、画面側はそれを使ってマスクを解釈する（写しの設定は変えない）。
 */
export async function batchRerunItems(admin: Admin, userId: string, _opts: BatchOpts, body: RerunBody): Promise<BatchResult> {
  const m = await memberOf(admin, userId)
  if (!m) return fail(403, 'not_a_member')
  if (!body?.jobId || !body.nodeId) return fail(400, 'job_id_required')
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === 'string') : []
  if (!itemIds.length) return fail(400, 'no_items', { message: '対象のアイテムがありません' })
  const { data: job } = await admin.from('batch_jobs').select('id, team_id, status, workflow_snapshot').eq('id', body.jobId).eq('team_id', m.teamId).maybeSingle()
  if (!job) return fail(404, 'job_not_found')
  if (['cancelled', 'uploading'].includes(job.status)) return fail(409, 'job_not_rerunnable', { status: job.status, message: 'このジョブは再実行できません' })
  const snapNode = (planTasks(job.workflow_snapshot).tasks).find((t) => t.nodeId === body.nodeId && t.kind === 'cutout')
  if (!snapNode) return fail(400, 'node_not_cutout', { message: '指定ノードは一括実行の切り抜きノードではありません' })

  const params = normalizeCutoutParams(body.params)
  const req = buildEngineRequest(params, '__IMAGE_URL__')
  const input: Record<string, unknown> = { ...req.input }
  delete input.image_url
  input.__kind = 'cutout'
  input.__params = params

  const { data: items } = await admin.from('batch_items').select('id').eq('job_id', job.id)
  const { data: tasks } = await admin.from('batch_tasks').select('id, item_id, node_id, status').eq('job_id', job.id)
  const plan = planRerun((tasks ?? []) as any[], ((items ?? []) as any[]).map((i) => i.id), body.nodeId, itemIds)
  if (!plan.taskIds.length) return ok({ jobId: job.id, rerunTasks: 0, skipped: plan.skipped, status: job.status })
  if (job.status === 'completed' || job.status === 'partial_failed') {
    const { count } = await admin.from('batch_jobs').select('id', { count: 'exact', head: true }).eq('team_id', m.teamId).in('status', ['uploading', 'submitted', 'processing'])
    if ((count ?? 0) >= MAX_ACTIVE_JOBS) return fail(429, 'active_jobs', { message: `同時に進行できるジョブは ${MAX_ACTIVE_JOBS} つまでです` })
  }
  const now = new Date().toISOString()
  await admin.from('batch_tasks').update({
    status: 'pending', attempts: 0, error: null, fal_request_id: null, submitted_at: null, completed_at: null,
    endpoint: req.endpoint, input, result_path: null, result_meta: null,
  }).in('id', plan.taskIds)
  // 結果が差し替わるので確認結果は未確認に戻す
  await admin.from('batch_items').update({ status: 'pending', review: 'unreviewed', reviewed_by: null, updated_at: now }).in('id', plan.itemIds)
  const { data: allTasks } = await admin.from('batch_tasks').select('status').eq('job_id', job.id)
  const st = ((allTasks ?? []) as Array<{ status: string }>).map((t) => t.status)
  await admin.from('batch_jobs').update({
    status: 'processing', completed_tasks: st.filter((s) => s === 'completed').length, failed_tasks: st.filter((s) => s === 'failed').length, updated_at: now,
  }).eq('id', job.id)
  return ok({ jobId: job.id, rerunTasks: plan.taskIds.length, skipped: plan.skipped, status: 'processing' })
}

// ───────────────────────── cancel / delete ─────────────────────────

async function cancelJobTasks(admin: Admin, opts: BatchOpts, job: any): Promise<number> {
  const { data: tasks } = await admin.from('batch_tasks').select('id, endpoint, fal_request_id, status').eq('job_id', job.id).in('status', ['pending', 'submitted'])
  for (const t of (tasks ?? []) as any[]) {
    if (t.status === 'submitted' && t.fal_request_id) await falCancel(opts.falKey, t.endpoint, t.fal_request_id)
  }
  const ids = ((tasks ?? []) as any[]).map((t) => t.id)
  if (ids.length) await admin.from('batch_tasks').update({ status: 'cancelled', completed_at: new Date().toISOString() }).in('id', ids)
  await admin.from('batch_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', job.id)
  return ids.length
}

export async function batchCancel(admin: Admin, userId: string, opts: BatchOpts, body: { jobId?: string }): Promise<BatchResult> {
  const m = await memberOf(admin, userId)
  if (!m) return fail(403, 'not_a_member')
  if (!body?.jobId) return fail(400, 'job_id_required')
  const { data: job } = await admin.from('batch_jobs').select('id, status').eq('id', body.jobId).eq('team_id', m.teamId).maybeSingle()
  if (!job) return fail(404, 'job_not_found')
  if (['completed', 'partial_failed', 'cancelled'].includes(job.status)) return ok({ jobId: job.id, cancelledTasks: 0, status: job.status })
  const n = await cancelJobTasks(admin, opts, job)
  return ok({ jobId: job.id, cancelledTasks: n, status: 'cancelled' })
}

/** prefix 配下の全ファイルを列挙する（フォルダは再帰）。 */
export async function listAllFiles(admin: Admin, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 5) return []
  const out: string[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await admin.storage.from(BATCH_BUCKET).list(prefix, { limit: 1000, offset })
    if (error || !data?.length) break
    for (const e of data as Array<{ name: string; id: string | null }>) {
      const p = `${prefix}/${e.name}`
      if (e.id) out.push(p)
      else out.push(...await listAllFiles(admin, p, depth + 1))
    }
    if (data.length < 1000) break
    offset += data.length
  }
  return out
}

export async function batchDelete(admin: Admin, userId: string, opts: BatchOpts, body: { jobId?: string }): Promise<BatchResult> {
  const m = await memberOf(admin, userId)
  if (!m) return fail(403, 'not_a_member')
  if (!body?.jobId) return fail(400, 'job_id_required')
  const { data: job } = await admin.from('batch_jobs').select('id, team_id, status, created_by').eq('id', body.jobId).eq('team_id', m.teamId).maybeSingle()
  if (!job) return fail(404, 'job_not_found')
  if (job.created_by !== userId && m.role !== 'owner') return fail(403, 'forbidden', { message: '削除できるのは投入者本人かオーナーだけです' })
  if (['uploading', 'submitted', 'processing'].includes(job.status)) await cancelJobTasks(admin, opts, job)
  const files = await listAllFiles(admin, `${job.team_id}/${job.id}`)
  let deleted = 0
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100)
    const { error } = await admin.storage.from(BATCH_BUCKET).remove(chunk)
    if (error) return fail(500, 'storage_delete_failed', { message: error.message, deleted })
    deleted += chunk.length
  }
  const { error } = await admin.from('batch_jobs').delete().eq('id', job.id)
  if (error) return fail(500, 'job_delete_failed', { message: error.message, deleted })
  return ok({ jobId: job.id, deletedFiles: deleted })
}
