export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'
import { withSentry } from '../_sentry'

// ライブラリの保持（2026-10-18）: ピン留めしていないアップロードは最終利用（last_used_at）から 30 日で削除する日次バッチ。
// Vercel Cron から呼ばれる。CRON_SECRET で認証。?dryRun=1 で件数だけ返す。1 回で最大 BATCH 件（残りは次回）。
const RETENTION_DAYS = Number(process.env.LIBRARY_RETENTION_DAYS) || 30
const BATCH = 200

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export default withSentry(handler)

async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return jsonResponse({ error: 'Forbidden' }, 403)
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server configuration error' }, 500)
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { count } = await admin.from('library_items').select('id', { count: 'exact', head: true }).eq('pinned', false).lt('last_used_at', cutoff)
  const { data: rows, error } = await admin.from('library_items').select('id, bucket, path').eq('pinned', false).lt('last_used_at', cutoff).order('last_used_at', { ascending: true }).limit(BATCH)
  if (error) return jsonResponse({ error: error.message }, 500)
  const batch = (rows ?? []) as Array<{ id: string; bucket: string; path: string }>
  if (dryRun || batch.length === 0) return jsonResponse({ dryRun, candidates: count ?? 0, deleted: 0, cutoff }, 200)

  // 先にファイル、次に行（ファイル削除に失敗した行は残して次回に回す）
  const byBucket = new Map<string, Array<{ id: string; path: string }>>()
  for (const r of batch) { const arr = byBucket.get(r.bucket) ?? []; arr.push({ id: r.id, path: r.path }); byBucket.set(r.bucket, arr) }
  const deletableIds: string[] = []
  let storageRemoved = 0
  for (const [bucket, items] of byBucket) {
    const { data: removed, error: rmErr } = await admin.storage.from(bucket).remove(items.map((i) => i.path))
    if (rmErr) continue
    const removedPaths = new Set((removed ?? []).map((o: { name: string }) => o.name))
    for (const i of items) { if (removedPaths.has(i.path)) { deletableIds.push(i.id); storageRemoved++ } else deletableIds.push(i.id) }   // 既に無いファイルも行は消す
  }
  if (deletableIds.length) await admin.from('library_items').delete().in('id', deletableIds)
  return jsonResponse({ dryRun: false, candidates: count ?? 0, deleted: deletableIds.length, storageRemoved, remaining: Math.max(0, (count ?? 0) - deletableIds.length), cutoff }, 200)
}
