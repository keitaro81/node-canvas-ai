import type { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { AuthModal } from './AuthModal'

interface AuthGuardProps {
  children: ReactNode
}

// ログイン不要で閲覧できる公開パス（法務ページ）。AuthModal からは新規タブで開く。
const PUBLIC_PATHS = ['/terms', '/privacy']

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuth()

  // 法務ページは認証を要求せず素通し（AuthGuard は Router の外側のため pathname を直接参照）。
  // /join/:token（招待リンク着地）も公開: 未ログインでもチーム名確認とアカウント作成（invite-gated signup）が
  // できるよう JoinPage 側で認証状態に応じて表示を切り替える。
  if (PUBLIC_PATHS.includes(window.location.pathname) || window.location.pathname.startsWith('/join/')) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg-canvas)' }}>
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 border-[#8B5CF6] border-t-transparent animate-spin"
          />
          <span className="text-[12px] text-[var(--text-tertiary)]">読み込み中...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="fixed inset-0" style={{ background: 'var(--bg-canvas)' }}>
        <AuthModal />
      </div>
    )
  }

  return <>{children}</>
}
