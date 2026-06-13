export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

// 保存期間（日）。GenerationCard の RETENTION_DAYS と一致させること。
const DEFAULT_RETENTION_DAYS = 30
// 1回の呼び出しで処理する最大件数（タイムアウト回避。storage.remove はバケット単位で一括）。
const BATCH = 500

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function parseStorageUrl(url: string | null): { bucket: string; path: string } | null {
  if (!url) return null
  const marker = '/object/public/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  const rest = url.slice(i + marker.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) }
}

async function removeStorageObjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  urls: (string | null)[],
): Promise<number> {
  const byBucket = new Map<string, string[]>()
  for (const u of urls) {
    const parsed = parseStorageUrl(u)
    if (!parsed) continue
    const list = byBucket.get(parsed.bucket) ?? []
    list.push(parsed.path)
    byBucket.set(parsed.bucket, list)
  }
  let removed = 0
  for (const [bucket, paths] of byBucket) {
    const { error } = await admin.storage.from(bucket).remove(paths)
    if (error) console.warn(`[cleanup] storage remove failed (${bucket}):`, error.message)
    else removed += paths.length
  }
  return removed
}

/**
 * 保存期間（既定30日）を過ぎた生成物を削除する日次バッチ。
 * Vercel Cron から呼ばれる。CRON_SECRET で認証。
 * - ?dryRun=1: 削除せず対象件数だけ返す（初回確認用）。
 * - 1回で最大 BATCH 件。バックログが多い場合は繰り返し呼ぶ（remaining が 0 になるまで）。
 * 注: キャンバスの参照は patch しない（表示ノードの onError プレースホルダで吸収）。
 */
export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === '1'
  const retentionDays = Number(process.env.RETENTION_DAYS) || DEFAULT_RETENTION_DAYS
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // 対象総数
  const { count: totalOlder } = await admin
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .lt('created_at', cutoff)

  if (dryRun) {
    return jsonResponse({ dryRun: true, retentionDays, cutoff, totalOlder: totalOlder ?? 0 }, 200)
  }

  // 1バッチ取得（古い順）
  const { data: rows, error } = await admin
    .from('generations')
    .select('id, output_url')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (error) return jsonResponse({ error: 'Lookup failed' }, 500)

  const batch = (rows ?? []) as { id: string; output_url: string | null }[]
  if (batch.length === 0) {
    return jsonResponse({ deleted: 0, storageRemoved: 0, remaining: 0, cutoff }, 200)
  }

  const storageRemoved = await removeStorageObjects(admin, batch.map((r) => r.output_url))
  const { error: delErr } = await admin
    .from('generations')
    .delete()
    .in('id', batch.map((r) => r.id))
  if (delErr) return jsonResponse({ error: 'Delete failed' }, 500)

  const remaining = Math.max(0, (totalOlder ?? batch.length) - batch.length)
  return jsonResponse({ deleted: batch.length, storageRemoved, remaining, cutoff }, 200)
}
