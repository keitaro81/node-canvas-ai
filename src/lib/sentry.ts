import * as Sentry from '@sentry/react'

/**
 * Sentry（エラー監視）を初期化する。
 * - `VITE_SENTRY_DSN` が無ければ何もしない（ローカル開発・未設定で無害）。
 * - DSN は公開可能な値（秘密鍵ではない）。Vercel の Production/Preview に設定する。
 * - environment は `VITE_SENTRY_ENVIRONMENT`（未設定なら Vite の MODE）で識別。
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
    // PII は送らない（メール等の個人情報を Sentry に渡さない）
    sendDefaultPii: false,
    // パフォーマンストレースは当面オフ（エラー監視のみ・コスト配慮）。必要なら上げる。
    tracesSampleRate: 0,
  })
}

export { Sentry }
