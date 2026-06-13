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
      .from('generations').select('id, output_url, user_id').eq('id', body.generationId).maybeSingle()
    if (!gen) throw new Error('Not found')
    if (gen.user_id !== userId) throw new Error('Forbidden')
    await removeStorageObjects(admin, [gen.output_url])
    await admin.from('generations').delete().eq('id', gen.id)
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

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ url: publicUrl }))
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
