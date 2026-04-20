import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../hooks/useToast'
import { supabase } from '../../lib/supabase'

function isOAuthUser(user: ReturnType<typeof useAuth>['user']): boolean {
  if (!user) return false
  const provider = user.app_metadata?.provider as string | undefined
  return provider === 'google' || provider === 'github'
}

export function MyPage() {
  const { user, sendPasswordResetEmail } = useAuth()
  const updatePassword = useAuthStore((s) => s.updatePassword)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)

  const isOAuth = isOAuthUser(user)

  // リセットメールのリンクから戻った場合（#type=recovery）
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSendReset() {
    if (!user?.email) return
    setIsSendingReset(true)
    try {
      await sendPasswordResetEmail(user.email)
      showToast('パスワードリセットメールを送信しました', 'success')
    } catch (err) {
      showToast((err as Error).message ?? 'メール送信に失敗しました', 'error')
    } finally {
      setIsSendingReset(false)
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword.length < 8) {
      showToast('パスワードは8文字以上で入力してください', 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('新しいパスワードが一致しません', 'error')
      return
    }
    setIsSaving(true)
    try {
      await updatePassword(newPassword)
      showToast('パスワードを変更しました', 'success')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      const msg = (err as Error).message ?? ''
      const localizedMsg = msg.includes('different from the old password')
        ? '現在と異なるパスワードを入力してください'
        : msg || 'パスワードの変更に失敗しました'
      showToast(localizedMsg, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-10">
      <h1 className="text-[18px] font-semibold mb-8" style={{ color: 'var(--text-primary)' }}>
        Account
      </h1>

      {/* Profile section */}
      <section className="mb-8">
        <h2 className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Profile
        </h2>
        <div
          className="rounded-xl border px-4 py-4"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex flex-col gap-1">
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Email</span>
            <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{user?.email ?? ''}</span>
          </div>
          {isOAuth && (
            <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
              Google アカウントでログイン中
            </p>
          )}
        </div>
      </section>

      {/* Password section */}
      {!isOAuth && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
            {isRecoveryMode ? 'New Password' : 'Change Password'}
          </h2>
          {isRecoveryMode && (
            <p className="text-[12px] mb-3" style={{ color: 'var(--text-secondary)' }}>
              新しいパスワードを設定してください。
            </p>
          )}
          <div
            className="rounded-xl border px-4 py-4"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  新しいパスワード
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="8文字以上"
                  className="rounded-md px-3 py-2 text-[13px] outline-none border focus:border-[var(--accent)]"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  新しいパスワード（確認）
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="もう一度入力"
                  className="rounded-md px-3 py-2 text-[13px] outline-none border focus:border-[var(--accent)]"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={isSaving}
                className="self-start px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity duration-150"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  opacity: (isSaving || newPassword.length < 8 || newPassword !== confirmPassword) ? 0.4 : 1,
                }}
              >
                {isSaving ? '変更中...' : 'パスワードを変更'}
              </button>
            </form>
            {!isRecoveryMode && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-[12px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  パスワードを忘れた場合はリセットメールを送信できます。
                </p>
                <button
                  onClick={handleSendReset}
                  disabled={isSendingReset}
                  className="text-[12px] transition-opacity duration-150 disabled:opacity-40"
                  style={{ color: 'var(--accent)' }}
                >
                  {isSendingReset ? '送信中...' : 'パスワードリセットメールを送信'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
