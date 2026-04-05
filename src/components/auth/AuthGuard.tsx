import type { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { AuthModal } from './AuthModal'

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuth()

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
