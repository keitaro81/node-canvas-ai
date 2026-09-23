// バッチ（一括実行）API クライアント。Edge: /api/batch/*、dev: /dev-proxy/batch/*（同一コア）。
import { supabase } from '../supabase'
import type { BatchItem, NodeData } from '../../types/nodes'
import type { Edge, Node } from '@xyflow/react'

const base = () => (import.meta.env.DEV ? '/dev-proxy/batch' : '/api/batch')

async function call<T>(action: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not authenticated')
  const res = await fetch(`${base()}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const msg = typeof json.message === 'string' ? json.message : typeof json.error === 'string' ? json.error : `batch ${action} failed (${res.status})`
    throw Object.assign(new Error(msg), { code: json.error, status: res.status, details: json })
  }
  return json as T
}

export interface BatchLimits { dailyLimit: number; usedToday: number; remaining: number; activeJobs: number; maxActiveJobs: number; maxItemsPerJob: number }
export interface BatchPlanInfo { itemTasks: number; jobTasks: number; totalTasks: number; estimatedCostUsd: number; estimatedSeconds: number; showCost: boolean; warnings: string[] }
export interface CreateItemInput { index: number; originalName: string; sku: string; interactivePath: string; width?: number; height?: number }
export interface WorkflowSnapshot { nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>; edges: Array<{ source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }> }

export interface CreateResult { jobId: string; itemIds: string[]; limits: BatchLimits; plan: BatchPlanInfo }
export interface DryRunResult { limits: BatchLimits; plan: BatchPlanInfo }
export interface SubmitResult { jobId: string; copied: number; copyFailures: string[]; tasksCreated: number; submitted: number; failedSubmits: number; pendingCopies: number; pendingTasks: number; totalTasks: number; done: boolean; jobStatus: string; webhook: boolean; warnings: string[] }
export interface ReconcileResult { checked: number; completed: number; failed: number; resubmitted: number; pending: number; skipped: number }

export const batchCreate = (body: { name?: string; items: CreateItemInput[]; workflowSnapshot: WorkflowSnapshot }) => call<CreateResult>('create', body)
export const batchDryRun = (body: { items: CreateItemInput[]; workflowSnapshot: WorkflowSnapshot }) => call<DryRunResult>('create', { ...body, dryRun: true })
export const batchSubmit = (body: { jobId: string; disableWebhook?: boolean; chunk?: number }) => call<SubmitResult>('submit', body)
export const batchReconcile = (body: { jobId?: string; minAgeSec?: number } = {}) => call<ReconcileResult>('reconcile', body)
export const batchCancel = (jobId: string) => call<{ jobId: string; cancelledTasks: number; status: string }>('cancel', { jobId })
export const batchDelete = (jobId: string) => call<{ jobId: string; deletedFiles: number }>('delete', { jobId })
export const batchRetry = (jobId: string) => call<{ jobId: string; retriedTasks: number; resetItems: number; status: string }>('retry', { jobId })
export const batchRerun = (body: { jobId: string; nodeId: string; itemIds: string[]; params: unknown }) => call<{ jobId: string; rerunTasks: number; skipped: Array<{ itemId: string; reason: string }>; status: string }>('rerun', body)

/** 投入を「残りなし」になるまで繰り返す（各呼び出しはチャンク単位・冪等）。 */
export async function submitJobFully(jobId: string, onProgress?: (r: SubmitResult) => void, opts: { disableWebhook?: boolean; maxRounds?: number } = {}): Promise<SubmitResult> {
  let last: SubmitResult | null = null
  for (let i = 0; i < (opts.maxRounds ?? 40); i++) {
    last = await batchSubmit({ jobId, disableWebhook: opts.disableWebhook })
    onProgress?.(last)
    if (last.done) return last
  }
  if (!last) throw new Error('submit did not run')
  return last
}

/** ワークフローの写し（投入時点のグラフ＋全パラメータ）。ノードの data から必要な部分だけ持つ。 */
export function buildWorkflowSnapshot(nodes: Node[], edges: Edge[]): WorkflowSnapshot {
  return {
    nodes: nodes.map((n) => {
      const d = (n.data ?? {}) as Partial<NodeData> & Record<string, unknown>
      const data: Record<string, unknown> = { type: d.type, label: d.label, params: d.params ?? {} }
      if (d.type === 'batchInput') {
        data.items = (Array.isArray(d.items) ? (d.items as BatchItem[]) : []).map((it) => ({ id: it.id, index: it.index, originalName: it.originalName, sku: it.sku, path: it.path, width: it.width, height: it.height, status: it.status }))
      }
      return { id: n.id, type: n.type, data }
    }),
    edges: edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null })),
  }
}

/** Batch Input ノードの準備完了アイテムを create の入力に変換する。 */
export function batchItemsFromNode(data: Record<string, unknown> | undefined): CreateItemInput[] {
  const items = Array.isArray(data?.items) ? (data!.items as BatchItem[]) : []
  return items
    .filter((it) => it.status === 'ready' && !!it.path)
    .map((it) => ({ index: it.index, originalName: it.originalName, sku: it.sku, interactivePath: it.path as string, width: it.width, height: it.height }))
}
