export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

// 孤児ストレージ GC: どこからも参照されず、かつ猶予期間より古いファイルを削除する。
// 参照動画（ReferenceVideoNode）等、generations に記録されないファイルが対象。
const BUCKETS = ['generated-images', 'generated-videos']
const GRACE_DAYS = 7
const DB_PAGE = 1000
const FOLDER_LIMIT = 2000 // 1バケットあたりの最大フォルダ走査数（安全上限）

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
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

/** DB を走査して「参照されているファイル」の集合（`<bucket>/<path>`）を作る。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildReferencedSet(admin: any): Promise<Set<string>> {
  const refs = new Set<string>()
  const add = (url: string | null) => {
    const p = parseStorageUrl(url)
    if (p) refs.add(`${p.bucket}/${p.path}`)
  }

  // 1) generations.output_url
  for (let from = 0; ; from += DB_PAGE) {
    const { data } = await admin
      .from('generations').select('output_url').not('output_url', 'is', null)
      .range(from, from + DB_PAGE - 1)
    const rows = (data ?? []) as { output_url: string | null }[]
    for (const r of rows) add(r.output_url)
    if (rows.length < DB_PAGE) break
  }

  // 2) workflows.canvas_data（ノードのURL）+ thumbnail_url
  for (let from = 0; ; from += DB_PAGE) {
    const { data } = await admin
      .from('workflows').select('canvas_data, thumbnail_url')
      .range(from, from + DB_PAGE - 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as { canvas_data: any; thumbnail_url: string | null }[]
    for (const w of rows) {
      add(w.thumbnail_url)
      const nodes = w.canvas_data?.nodes
      if (Array.isArray(nodes)) {
        for (const n of nodes) {
          const d = n?.data ?? {}
          add(d.output); add(d.videoUrl); add(d.imageUrl); add(d.uploadedImagePreview)
          if (d.params) add(d.params.imageUrl)
        }
      }
    }
    if (rows.length < DB_PAGE) break
  }

  return refs
}

export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server configuration error' }, 500)

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === '1'
  const graceDays = Number(url.searchParams.get('graceDays')) || GRACE_DAYS
  const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const refs = await buildReferencedSet(admin)

  const orphansByBucket: Record<string, string[]> = {}
  let scannedFiles = 0
  for (const bucket of BUCKETS) {
    orphansByBucket[bucket] = []
    // 直下のフォルダ（<nodeId>）を列挙
    const { data: folders } = await admin.storage.from(bucket).list('', { limit: FOLDER_LIMIT })
    for (const folder of (folders ?? []) as { name: string; id: string | null }[]) {
      if (folder.id !== null) continue // ルート直下のファイルは想定外（フォルダのみ処理）
      const { data: files } = await admin.storage.from(bucket).list(folder.name, { limit: 100 })
      for (const f of (files ?? []) as { name: string; created_at: string | null }[]) {
        scannedFiles++
        const path = `${folder.name}/${f.name}`
        if (refs.has(`${bucket}/${path}`)) continue // 参照あり → 残す
        const created = f.created_at ? Date.parse(f.created_at) : 0
        if (created && created > cutoff) continue // 猶予期間内 → 残す
        orphansByBucket[bucket].push(path)
      }
    }
  }

  const orphanCount = Object.values(orphansByBucket).reduce((s, a) => s + a.length, 0)

  if (dryRun) {
    return jsonResponse({
      dryRun: true, graceDays, referencedCount: refs.size, scannedFiles, orphanCount,
      perBucket: Object.fromEntries(Object.entries(orphansByBucket).map(([b, a]) => [b, a.length])),
      sample: Object.entries(orphansByBucket).flatMap(([b, a]) => a.slice(0, 10).map((p) => `${b}/${p}`)),
    }, 200)
  }

  let deleted = 0
  for (const [bucket, paths] of Object.entries(orphansByBucket)) {
    if (paths.length === 0) continue
    const { error } = await admin.storage.from(bucket).remove(paths)
    if (error) console.warn(`[orphan-gc] remove failed (${bucket}):`, error.message)
    else deleted += paths.length
  }
  return jsonResponse({ deleted, graceDays, scannedFiles, referencedCount: refs.size }, 200)
}
