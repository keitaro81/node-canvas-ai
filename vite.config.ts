import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

// SSRF対策: fal.ai の生成物配信ドメイン以外はサーバーサイド fetch しない
// （api/storage/save-image.ts と同一ロジック。変更時は両方更新する）
function isAllowedSourceUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false
  return url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media')
}

const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// 履歴削除のサーバーロジック（api/storage/delete-generation.ts と同一。変更時は両方更新）
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
function clearDeletedUrlFromCanvas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canvasData: any,
  url: string,
): { changed: boolean; data: unknown } {
  if (!canvasData || !Array.isArray(canvasData.nodes)) return { changed: false, data: canvasData }
  let changed = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes = canvasData.nodes.map((node: any) => {
    const d = node?.data ?? {}
    const next = { ...d }
    let nodeChanged = false
    for (const f of ['output', 'imageUrl', 'videoUrl', 'uploadedImagePreview']) {
      if (next[f] === url) { next[f] = null; nodeChanged = true }
    }
    if (next.params && next.params.imageUrl === url) {
      next.params = { ...next.params, imageUrl: null }
      nodeChanged = true
    }
    if (nodeChanged) { next.deleted = true; changed = true; return { ...node, data: next } }
    return node
  })
  return changed ? { changed: true, data: { ...canvasData, nodes } } : { changed: false, data: canvasData }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function removeStorageObjects(admin: any, urls: (string | null)[]): Promise<void> {
  const byBucket = new Map<string, string[]>()
  for (const u of urls) {
    const parsed = parseStorageUrl(u)
    if (!parsed) continue
    const list = byBucket.get(parsed.bucket) ?? []
    list.push(parsed.path)
    byBucket.set(parsed.bucket, list)
  }
  for (const [bucket, paths] of byBucket) {
    const { error } = await admin.storage.from(bucket).remove(paths)
    if (error) console.warn(`[dev-delete] storage remove failed (${bucket}):`, error.message)
  }
}
async function deleteGenerationServer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  body: { generationId?: string; workflowId?: string },
): Promise<{ deleted: number }> {
  if (body.generationId) {
    const { data: gen } = await admin
      .from('generations').select('id, output_url, user_id, workflow_id').eq('id', body.generationId).maybeSingle()
    if (!gen) throw new Error('Not found')
    if (gen.user_id !== userId) throw new Error('Forbidden')
    await removeStorageObjects(admin, [gen.output_url])
    await admin.from('generations').delete().eq('id', gen.id)
    // キャンバスの参照クリア + サムネ修正（同一ワークフロー）
    if (gen.output_url && gen.workflow_id) {
      const { data: wf } = await admin
        .from('workflows').select('canvas_data, thumbnail_url').eq('id', gen.workflow_id).maybeSingle()
      if (wf) {
        const patch: Record<string, unknown> = {}
        const { changed, data } = clearDeletedUrlFromCanvas(wf.canvas_data, gen.output_url)
        if (changed) patch.canvas_data = data
        if (wf.thumbnail_url === gen.output_url) patch.thumbnail_url = null
        if (Object.keys(patch).length > 0) await admin.from('workflows').update(patch).eq('id', gen.workflow_id)
      }
    }
    return { deleted: 1 }
  }
  if (body.workflowId) {
    const { data: wf } = await admin.from('workflows').select('id, project_id').eq('id', body.workflowId).maybeSingle()
    if (!wf) return { deleted: 0 }
    const { data: project } = await admin.from('projects').select('user_id').eq('id', wf.project_id).maybeSingle()
    if (!project || project.user_id !== userId) throw new Error('Forbidden')
    const { data: gens } = await admin.from('generations').select('id, output_url').eq('workflow_id', body.workflowId)
    const rows = (gens ?? []) as { id: string; output_url: string | null }[]
    await removeStorageObjects(admin, rows.map((r) => r.output_url))
    await admin.from('generations').delete().eq('workflow_id', body.workflowId)
    return { deleted: rows.length }
  }
  throw new Error('Missing generationId or workflowId')
}

// ===== L2 署名（api/storage/sign-media.ts と同一ロジック。変更時は両方更新）=====
const SIGN_PRIVATE_BUCKETS = ['generated-images', 'generated-videos']
const SIGN_TOP_FIELDS = ['output', 'videoUrl', 'imageUrl', 'uploadedImagePreview', 'maskUrl']
const SIGN_PARAM_FIELDS = ['imageUrl', 'maskUrl']
const SIGN_TTL = 60 * 60 * 24
function parseStorageUrlSign(url: unknown): { bucket: string; path: string } | null {
  if (!url || typeof url !== 'string') return null
  for (const marker of ['/object/public/', '/object/sign/']) {
    const i = url.indexOf(marker)
    if (i === -1) continue
    let rest = url.slice(i + marker.length)
    const q = rest.indexOf('?'); if (q !== -1) rest = rest.slice(0, q)
    const slash = rest.indexOf('/'); if (slash === -1) return null
    const bucket = rest.slice(0, slash)
    if (!SIGN_PRIVATE_BUCKETS.includes(bucket)) return null
    const path = decodeURIComponent(rest.slice(slash + 1))
    return path ? { bucket, path } : null
  }
  return null
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectCanvasMediaDev(canvasData: any, thumbnailUrl: string | null): string[] {
  const out: string[] = []
  const add = (v: unknown) => { if (typeof v === 'string' && v && parseStorageUrlSign(v)) out.push(v) }
  add(thumbnailUrl)
  const nodes = canvasData?.nodes
  if (Array.isArray(nodes)) for (const n of nodes) {
    const d = n?.data ?? {}
    for (const f of SIGN_TOP_FIELDS) add(d[f])
    if (d.params) for (const f of SIGN_PARAM_FIELDS) add(d.params[f])
  }
  return out
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function signUrlsDev(admin: any, urls: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const buckets = new Map<string, Map<string, string[]>>()
  for (const u of urls) {
    if (out[u]) continue
    const parsed = parseStorageUrlSign(u); if (!parsed) continue
    let pm = buckets.get(parsed.bucket); if (!pm) { pm = new Map(); buckets.set(parsed.bucket, pm) }
    const arr = pm.get(parsed.path); if (arr) arr.push(u); else pm.set(parsed.path, [u])
  }
  for (const [bucket, pm] of buckets) {
    const paths = [...pm.keys()]; if (!paths.length) continue
    try {
      const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, SIGN_TTL)
      if (error || !data) continue
      for (const item of data as Array<{ error: string | null; path: string | null; signedUrl: string }>) {
        if (item.error || !item.signedUrl || !item.path) continue
        const vals = pm.get(item.path)
        if (vals) for (const v of vals) out[v] = item.signedUrl
      }
    } catch { continue }
  }
  return out
}
async function signMediaServer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  body: { workflowId?: string; urls?: unknown; ownUrls?: unknown },
): Promise<{ map: Record<string, string>; forbidden?: boolean }> {
  const { data: member } = await admin.from('team_members').select('team_id').eq('user_id', userId).limit(1).maybeSingle()
  const callerTeamId: string | null = member?.team_id ?? null
  const toSign: string[] = []
  if (typeof body.workflowId === 'string' && body.workflowId) {
    const { data: wf } = await admin.from('workflows')
      .select('project_id, canvas_data, thumbnail_url, visibility, team_id, projects(user_id)')
      .eq('id', body.workflowId).maybeSingle()
    if (wf) {
      const ownerId: string | undefined = wf.projects?.user_id
      const visibility: string = wf.visibility ?? 'private'
      const isOwner = !!ownerId && ownerId === userId
      const isPublic = visibility === 'public'
      const isTeam = visibility === 'team' && !!wf.team_id && !!callerTeamId && wf.team_id === callerTeamId
      if (isOwner || isPublic || isTeam) toSign.push(...collectCanvasMediaDev(wf.canvas_data, wf.thumbnail_url))
      else return { map: {}, forbidden: true }
    }
  }
  if (Array.isArray(body.urls) && body.urls.length) {
    const urls = (body.urls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 600)
    const { data: gens } = await admin.from('generations').select('output_url, user_id, workflow_id').in('output_url', urls)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (gens ?? []) as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const needWf: any[] = []
    for (const g of rows) {
      if (!g.output_url) continue
      if (g.user_id === userId) toSign.push(g.output_url)
      else if (g.workflow_id) needWf.push(g)
    }
    if (needWf.length) {
      const wfIds = [...new Set(needWf.map((g) => g.workflow_id))]
      const { data: wfs } = await admin.from('workflows').select('id, visibility, team_id').in('id', wfIds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wfMap = new Map<string, any>(((wfs ?? []) as any[]).map((w) => [w.id, w]))
      for (const g of needWf) {
        const w = wfMap.get(g.workflow_id)
        if (!w) continue
        if (w.visibility === 'public' || (w.visibility === 'team' && !!w.team_id && !!callerTeamId && w.team_id === callerTeamId)) toSign.push(g.output_url)
      }
    }
  }
  if (Array.isArray(body.ownUrls) && body.ownUrls.length) {
    const ownUrls = (body.ownUrls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 600)
    const keys: string[] = []
    const keyToUrls = new Map<string, string[]>()
    for (const u of ownUrls) {
      const p = parseStorageUrlSign(u); if (!p) continue
      const key = `${p.bucket}/${p.path}`; keys.push(key)
      const arr = keyToUrls.get(key); if (arr) arr.push(u); else keyToUrls.set(key, [u])
    }
    if (keys.length) {
      const { data: ownedKeys } = await admin.rpc('storage_keys_owned_by', { p_user: userId, p_keys: keys })
      for (const k of ((ownedKeys ?? []) as string[])) { const urls = keyToUrls.get(k); if (urls) toSign.push(...urls) }
    }
  }
  const map = await signUrlsDev(admin, toSign)
  return { map }
}

/**
 * ローカル開発専用: 画像をサーバーサイドで fetch して Supabase Storage に保存する
 * Vite Dev Server ミドルウェア。
 * POST /dev-proxy/save-image { sourceUrl, nodeId } → { url: publicUrl }
 */
function devImageProxyPlugin(): Plugin {
  let supabaseUrl: string | undefined
  let serviceKey: string | undefined

  return {
    name: 'dev-image-proxy',
    apply: 'serve',
    config(_, { mode }) {
      // loadEnv にプレフィックス '' を指定することで VITE_ 以外の変数も取得できる
      const env = loadEnv(mode, process.cwd(), '')
      supabaseUrl = env.VITE_SUPABASE_URL
      serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
    },
    configureServer(server) {
      server.middlewares.use(
        '/dev-proxy/save-image',
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }

          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString()) as {
                sourceUrl?: string
                nodeId?: string
              }
              const { sourceUrl, nodeId } = body
              if (!sourceUrl || !nodeId) throw new Error('Missing sourceUrl or nodeId')

              let parsedSource: URL
              try {
                parsedSource = new URL(sourceUrl)
              } catch {
                throw new Error('Invalid source URL')
              }
              if (!isAllowedSourceUrl(parsedSource)) {
                throw new Error(`Source URL not allowed: ${parsedSource.hostname}`)
              }
              if (!NODE_ID_PATTERN.test(nodeId)) {
                throw new Error('Invalid nodeId')
              }

              if (!supabaseUrl || !serviceKey) {
                throw new Error(
                  'SUPABASE_SERVICE_ROLE_KEY が .env.local に設定されていません。' +
                  'Supabase Dashboard → Project Settings → API → service_role key を .env.local に追加してください。'
                )
              }

              // サーバーサイドで fal.ai URL を fetch（CORS 不要）
              const imgRes = await fetch(sourceUrl)
              if (!imgRes.ok) throw new Error(`Fetch failed: ${imgRes.status}`)

              const rawCT = imgRes.headers.get('content-type') ?? 'image/png'
              const isJpeg = rawCT.includes('jpeg') || rawCT.includes('jpg')
              const isWebp = rawCT.includes('webp')
              const contentType = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png'
              const ext = isJpeg ? 'jpg' : isWebp ? 'webp' : 'png'
              const storagePath = `${nodeId}/${Date.now()}.${ext}`

              const arrayBuffer = await imgRes.arrayBuffer()
              const buffer = Buffer.from(arrayBuffer)

              // Supabase Storage にアップロード（service role key でRLS バイパス）
              const { createClient } = await import('@supabase/supabase-js')
              const admin = createClient(supabaseUrl, serviceKey)
              const { error: uploadError } = await admin.storage
                .from('generated-images')
                .upload(storagePath, buffer, { contentType, upsert: false })
              if (uploadError) throw uploadError

              const { data: { publicUrl } } = admin.storage
                .from('generated-images')
                .getPublicUrl(storagePath)

              // L2: 即時表示用に署名URLも返す（service role アップ=owner null のため）
              let signedUrl: string | null = null
              try {
                const { data: signed } = await admin.storage
                  .from('generated-images')
                  .createSignedUrl(storagePath, 60 * 60 * 24)
                signedUrl = signed?.signedUrl ?? null
              } catch { signedUrl = null }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ url: publicUrl, signedUrl }))
            } catch (err) {
              console.error('[dev-image-proxy] error:', err)
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(err) }))
            }
          })
        }
      )

      // 履歴削除: POST /dev-proxy/delete-generation { generationId | workflowId }
      server.middlewares.use(
        '/dev-proxy/delete-generation',
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', async () => {
            try {
              if (!supabaseUrl || !serviceKey) {
                throw new Error('SUPABASE_SERVICE_ROLE_KEY が .env.local に設定されていません。')
              }
              const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
              if (!token) throw new Error('No token')
              const body = JSON.parse(Buffer.concat(chunks).toString()) as {
                generationId?: string
                workflowId?: string
              }
              const { createClient } = await import('@supabase/supabase-js')
              const admin = createClient(supabaseUrl, serviceKey)
              const { data: { user } } = await admin.auth.getUser(token)
              if (!user) throw new Error('Unauthorized')
              const result = await deleteGenerationServer(admin, user.id, body)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } catch (err) {
              console.error('[dev-delete-generation] error:', err)
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(err) }))
            }
          })
        }
      )

      // L2 テナント分離: POST /dev-proxy/sign-media { workflowId? | urls? | ownUrls? } → { map }
      server.middlewares.use(
        '/dev-proxy/sign-media',
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', async () => {
            try {
              if (!supabaseUrl || !serviceKey) {
                throw new Error('SUPABASE_SERVICE_ROLE_KEY が .env.local に設定されていません。')
              }
              const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
              if (!token) throw new Error('No token')
              const body = JSON.parse(Buffer.concat(chunks).toString()) as {
                workflowId?: string; urls?: unknown; ownUrls?: unknown
              }
              const { createClient } = await import('@supabase/supabase-js')
              const admin = createClient(supabaseUrl, serviceKey)
              const { data: { user } } = await admin.auth.getUser(token)
              if (!user) throw new Error('Unauthorized')
              const result = await signMediaServer(admin, user.id, body)
              if (result.forbidden) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Forbidden' }))
                return
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ map: result.map }))
            } catch (err) {
              console.error('[dev-sign-media] error:', err)
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: String(err) }))
            }
          })
        }
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), devImageProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
