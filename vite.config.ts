import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

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
