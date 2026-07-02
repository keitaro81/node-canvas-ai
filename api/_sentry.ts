// Edge Functions 用 Sentry 共有ヘルパー。
// `_` 始まりのファイルは Vercel のルーティング対象外（共有モジュール）。
// SENTRY_DSN（サーバー側 env）未設定なら完全に no-op。
import * as Sentry from '@sentry/vercel-edge'

let initialized = false
function ensureInit(): void {
  if (initialized) return
  initialized = true
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || 'development',
    tracesSampleRate: 0, // エラー監視のみ（トレースはオフ・コスト配慮）
  })
}

/**
 * Edge ハンドラを包み、未捕捉例外を Sentry に報告してから再 throw する。
 * SENTRY_DSN 未設定時は捕捉・再throw のみ（送信なし）。
 */
export function withSentry(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    ensureInit()
    try {
      return await handler(req)
    } catch (err) {
      Sentry.captureException(err)
      await Sentry.flush(2000)
      throw err
    }
  }
}
