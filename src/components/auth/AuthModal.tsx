import { useState } from 'react'
import { Mail, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

type Tab = 'signin' | 'signup' | 'reset'

export function AuthModal() {
  const { signIn, signUp, signInWithGoogle, sendPasswordResetEmail } = useAuth()

  const [tab, setTab] = useState<Tab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccessMsg(null)
    setLoading(true)
    try {
      if (tab === 'signin') {
        await signIn(email, password)
      } else if (tab === 'signup') {
        await signUp(email, password)
        setSuccessMsg('確認メールを送信しました。メールをご確認ください。')
      } else {
        await sendPasswordResetEmail(email)
        setSuccessMsg('パスワードリセットメールを送信しました。メールをご確認ください。')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Googleログインに失敗しました')
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="w-[400px] rounded-[12px] border border-[var(--border)] p-8 flex flex-col gap-6"
        style={{ background: 'var(--bg-surface)' }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[20px] font-semibold text-[var(--text-primary)]">Node Canvas AI</span>
          <span className="text-[13px] text-[var(--text-secondary)]">AIワークフローを構築しましょう</span>
        </div>

        {/* Tabs */}
        {tab !== 'reset' && (
          <div className="flex rounded-[8px] border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-canvas)' }}>
            {(['signin', 'signup'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); setSuccessMsg(null) }}
                className="flex-1 py-2 text-[13px] font-medium transition-colors duration-150"
                style={{
                  background: tab === t ? 'var(--bg-elevated)' : 'transparent',
                  color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              >
                {t === 'signin' ? 'ログイン' : '新規登録'}
              </button>
            ))}
          </div>
        )}
        {tab === 'reset' && (
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold text-center" style={{ color: 'var(--text-primary)' }}>パスワードをリセット</span>
            <span className="text-[12px] text-center" style={{ color: 'var(--text-secondary)' }}>登録済みのメールアドレスにリセットリンクを送信します</span>
          </div>
        )}

        {/* Google */}
        <button
          onClick={handleGoogle}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-[8px] border border-[var(--border-active)] text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
          style={{ background: 'transparent' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Googleでログイン
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <span className="text-[11px] text-[var(--text-tertiary)]">または</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-[var(--text-secondary)]">メールアドレス</label>
            <div className="flex items-center rounded-[6px] border border-[var(--border)] px-3 focus-within:border-[var(--border-active)]" style={{ background: 'var(--bg-canvas)' }}>
              <Mail size={13} style={{ color: 'var(--text-tertiary)' }} className="shrink-0" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none py-2 px-2"
              />
            </div>
          </div>

          {tab !== 'reset' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">パスワード</label>
                {tab === 'signin' && (
                  <button
                    type="button"
                    onClick={() => { setTab('reset'); setError(null); setSuccessMsg(null) }}
                    className="text-[11px] transition-colors duration-150"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    パスワードをお忘れの方
                  </button>
                )}
              </div>
              <div className="flex items-center rounded-[6px] border border-[var(--border)] px-3 focus-within:border-[var(--border-active)]" style={{ background: 'var(--bg-canvas)' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none py-2"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="ml-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-[12px] text-[#EF4444] bg-[#EF444410] rounded-[6px] px-3 py-2">{error}</p>
          )}
          {successMsg && (
            <p className="text-[12px] text-[#22C55E] bg-[#22C55E10] rounded-[6px] px-3 py-2">{successMsg}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 rounded-[8px] text-[13px] font-medium text-white transition-all duration-150 disabled:opacity-50"
            style={{ background: '#8B5CF6' }}
          >
            {loading ? '処理中...' : tab === 'signin' ? 'ログイン' : tab === 'signup' ? '登録する' : 'リセットメールを送信'}
          </button>
          {tab === 'reset' && (
            <button
              type="button"
              onClick={() => { setTab('signin'); setError(null); setSuccessMsg(null) }}
              className="text-[12px] text-center transition-colors duration-150"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ← ログインに戻る
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
