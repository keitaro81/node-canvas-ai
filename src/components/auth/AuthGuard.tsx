import type { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useMfaStore } from '../../stores/mfaStore'
import { AuthModal } from './AuthModal'
import { MfaChallengeScreen, MfaEnrollScreen } from './MfaGateScreens'

interface AuthGuardProps {
  children: ReactNode
}

// ログイン不要で閲覧できる公開パス（法務ページ）。AuthModal からは新規タブで開く。
const PUBLIC_PATHS = ['/terms', '/privacy']

function LoadingScreen() {
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

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuth()
  const mfaStatus = useMfaStore((s) => s.status)

  // 法務ページは認証を要求せず素通し（AuthGuard は Router の外側のため pathname を直接参照）。
  if (PUBLIC_PATHS.includes(window.location.pathname)) {
    return <>{children}</>
  }
  // /join/:token（招待リンク着地）は未ログインでも見せる: チーム名確認とアカウント作成（invite-gated signup）が
  // できるよう JoinPage 側で認証状態に応じて表示を切り替える。ログイン済みなら、下の 2 段階認証の確認は通す。
  const onJoinPage = window.location.pathname.startsWith('/join/')
  if (onJoinPage && (loading || !user)) {
    return <>{children}</>
  }

  if (loading) return <LoadingScreen />

  if (!user) {
    return (
      <div className="fixed inset-0" style={{ background: 'var(--bg-canvas)' }}>
        <AuthModal />
      </div>
    )
  }

  // 2 段階認証（2026-11-14）: 認証アプリを登録済みならコード入力、チームが必須なのに未登録なら登録。
  // ここは画面を出さないだけで、強制そのものはサーバー側（DB の mfa_gate ポリシーと Edge の確認）にある。
  // 招待リンクのページは、判定を待つ間も出したままにする: その場でアカウントを作ってログインした直後に、
  // 「参加しました」の表示が読み込み中の画面で消えないように（ページの操作はサーバー側でも確認される）。
  // 判定が出て 2 段階目が要るなら、下の画面に替わる
  if (mfaStatus === 'unknown') return onJoinPage ? <>{children}</> : <LoadingScreen />
  if (mfaStatus === 'challenge') return <MfaChallengeScreen />
  if (mfaStatus === 'enroll') return <MfaEnrollScreen />

  return <>{children}</>
}
