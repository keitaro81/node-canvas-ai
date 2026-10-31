// 商品動画 App の結果（SKU ごとの終端の動画 = 結合、無ければ生成）をライブラリの「生成動画」と「動画を追加」ダイアログに並べる（2026-10-31・ユーザー指摘）。
// 動画は batch バケット <team>/<job>/<item>/<node>-result.mp4 にあり、見える範囲は RLS（can_view_batch_job）に従う。保持は処理の履歴と一緒（削除は履歴から）
// 終端の判定: 新しいタスクは input.__terminal、古いタスク（__inputs 無し）は node_id に ':shot:' を含まないもの
import { supabase } from '../supabase'
import { signMediaRequest } from './storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any

export interface BatchVideo {
  id: string            // 結合タスクの id
  jobId: string
  jobName: string
  workflowId: string | null
  createdBy: string | null
  sku: string
  path: string          // batch バケットのパス
  url: string           // 保存形式の URL（/object/public/batch/<path>）。表示・生成時に署名する
  completedAt: string
}

export const batchCanonicalUrl = (path: string): string => supabase.storage.from('batch').getPublicUrl(path).data.publicUrl

export async function listBatchVideos(limit = 200): Promise<BatchVideo[]> {
  const { data: jobs, error } = await sb.from('batch_jobs').select('id, name, workflow_id, created_by, status').eq('kind', 'video').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(60)
  if (error) throw new Error(error.message)
  const jobList = (jobs ?? []) as Array<{ id: string; name: string; workflow_id: string | null; created_by: string | null }>
  if (!jobList.length) return []
  const { data: tasks } = await sb.from('batch_tasks').select('id, job_id, item_id, node_id, result_path, completed_at, input').in('job_id', jobList.map((j) => j.id)).eq('status', 'completed').not('result_path', 'is', null)
  const merges = ((tasks ?? []) as Array<{ id: string; job_id: string; item_id: string | null; node_id: string; result_path: string; completed_at: string | null; input?: Record<string, unknown> | null }>).filter((t) => !!t.item_id && isTerminalVideoTask(t))
  const itemIds = [...new Set(merges.map((t) => t.item_id as string))]
  const { data: items } = itemIds.length ? await sb.from('batch_items').select('id, sku').in('id', itemIds) : { data: [] }
  const skuOf = new Map(((items ?? []) as Array<{ id: string; sku: string }>).map((i) => [i.id, i.sku]))
  const jobOf = new Map(jobList.map((j) => [j.id, j]))
  return merges
    .map((t): BatchVideo => { const j = jobOf.get(t.job_id); return { id: t.id, jobId: t.job_id, jobName: j?.name ?? '', workflowId: j?.workflow_id ?? null, createdBy: j?.created_by ?? null, sku: skuOf.get(t.item_id as string) ?? '', path: t.result_path, url: batchCanonicalUrl(t.result_path), completedAt: t.completed_at ?? '' } })
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
    .slice(0, limit)
}

/** 終端の動画タスクか（結果欄・ライブラリに出す 1 本）。新: input.__terminal / 旧（__inputs 無し）: ':shot:' を含まない node_id */
export function isTerminalVideoTask(t: { node_id: string; input?: Record<string, unknown> | null }): boolean {
  const input = t.input ?? {}
  if (input.__terminal === true) return true
  if (input.__terminal === false) return false
  return input.__inputs === undefined && !t.node_id.includes(':shot:')
}

/** 表示用の署名 URL（動画 id → url） */
export async function signBatchVideos(videos: Array<Pick<BatchVideo, 'id' | 'path'>>): Promise<Record<string, string>> {
  if (!videos.length) return {}
  const map = await signMediaRequest({ batchPaths: videos.map((v) => v.path) })
  const out: Record<string, string> = {}
  for (const v of videos) if (map[v.path]) out[v.id] = map[v.path]
  return out
}
