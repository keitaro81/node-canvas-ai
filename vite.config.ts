import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
// `_` プレフィックス = Vercel が /api 配下で関数化しない共有モジュール（_sentry.ts と同じ規約）。
// dev ミドルウェアは対応する Edge 関数と「同一の共有コア」を呼ぶ（ロジックの二重管理を排除）。
import { teamManage, actionNeedsAuth, type TeamManageBody } from './api/team/_teamLogic'
import { saveImageServer } from './api/storage/_saveImageLogic'
import { deleteGenerationServer } from './api/storage/_deleteGenerationLogic'
import { signMediaServer } from './api/storage/_signMediaLogic'

/**
 * ローカル開発専用: 本番(Vercel)の Edge 関数を代替する Vite Dev Server ミドルウェア群。
 * 各ハンドラは service role key で admin クライアントを作り、Edge 関数と同一の共有コアを呼ぶだけ。
 * （save-image / delete-generation / sign-media / team-manage）
 */
function devImageProxyPlugin(): Plugin {
  let supabaseUrl: string | undefined
  let serviceKey: string | undefined

  // JSON ボディを読む（空なら {}）
  const readJson = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')) } catch (e) { reject(e) } })
      req.on('error', reject)
    })

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
      // service role admin を作る（未設定なら分かりやすいエラー）
      const getAdmin = async () => {
        if (!supabaseUrl || !serviceKey) {
          throw new Error('SUPABASE_SERVICE_ROLE_KEY が .env.local に設定されていません。')
        }
        const { createClient } = await import('@supabase/supabase-js')
        return createClient(supabaseUrl, serviceKey)
      }
      const send = (res: ServerResponse, status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      const bearer = (req: IncomingMessage) => (req.headers.authorization ?? '').replace(/^Bearer /, '')

      // POST /dev-proxy/save-image { sourceUrl, nodeId } → { url, signedUrl }
      // 注: dev の save-image はクライアントが token を送らない設計のため未認証（Edge は認証あり）。
      server.middlewares.use('/dev-proxy/save-image', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        try {
          const admin = await getAdmin()
          const body = await readJson(req) as { sourceUrl?: string; nodeId?: string }
          const result = await saveImageServer(admin, body)
          send(res, result.status, result.body)
        } catch (err) {
          console.error('[dev-save-image] error:', err)
          send(res, 500, { error: String(err) })
        }
      })

      // POST /dev-proxy/delete-generation { generationId | workflowId }（認証必須）
      server.middlewares.use('/dev-proxy/delete-generation', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        try {
          const admin = await getAdmin()
          const token = bearer(req); if (!token) throw new Error('No token')
          const { data: { user } } = await admin.auth.getUser(token)
          if (!user) throw new Error('Unauthorized')
          const body = await readJson(req) as { generationId?: string; workflowId?: string }
          const result = await deleteGenerationServer(admin, user.id, body)
          send(res, result.status, result.body)
        } catch (err) {
          console.error('[dev-delete-generation] error:', err)
          send(res, 500, { error: String(err) })
        }
      })

      // L2 テナント分離: POST /dev-proxy/sign-media { workflowId? | urls? | ownUrls? } → { map }（認証必須）
      server.middlewares.use('/dev-proxy/sign-media', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        try {
          const admin = await getAdmin()
          const token = bearer(req); if (!token) throw new Error('No token')
          const { data: { user } } = await admin.auth.getUser(token)
          if (!user) throw new Error('Unauthorized')
          const body = await readJson(req) as { workflowId?: string; urls?: unknown; ownUrls?: unknown }
          const result = await signMediaServer(admin, user.id, body)
          send(res, result.status, result.body)
        } catch (err) {
          console.error('[dev-sign-media] error:', err)
          send(res, 500, { error: String(err) })
        }
      })

      // チーム管理: POST /dev-proxy/team-manage { action, ... }（preview/signup は未認証可）
      server.middlewares.use('/dev-proxy/team-manage', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        try {
          const admin = await getAdmin()
          const body = await readJson(req) as TeamManageBody
          // preview / signup（invite-gated signup）は未認証で可。それ以外は JWT 検証
          let userId: string | null = null
          if (actionNeedsAuth(body?.action)) {
            const token = bearer(req); if (!token) throw new Error('No token')
            const { data: { user } } = await admin.auth.getUser(token)
            if (!user) throw new Error('Unauthorized')
            userId = user.id
          }
          const result = await teamManage(admin, userId, body)
          send(res, result.status, result.body)
        } catch (err) {
          console.error('[dev-team-manage] error:', err)
          send(res, 500, { error: String(err) })
        }
      })
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
