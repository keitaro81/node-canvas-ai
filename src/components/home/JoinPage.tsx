import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { CircleNotch, UsersThree, CheckCircle, XCircle } from '@phosphor-icons/react'
import { joinTeam, previewInvite, signupAndJoin } from '../../lib/api/team'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

// 招待リンクの着地ページ（/join/:token）。AuthGuard の公開パス（未ログインでも表示される）。
// - ログイン済み: opt-in 確認 →「参加する」で join。
// - 未ログイン: チーム名を確認した上で「アカウントを作成して参加」（invite-gated signup）or ログイン。
export function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  // token 無しは最初から error（effect 内の同期 setState を避けるため初期値で導出）
  const [state, setState] = useState<'loading' | 'confirm' | 'joining' | 'done' | 'error'>(() => (token ? 'loading' : 'error'))
  const [message, setMessage] = useState<string | null>(() => (token ? null : '無効な招待リンクです'))
  const [teamName, setTeamName] = useState<string | null>(null)

  // 未ログイン時のフォーム（signup=アカウント作成 / login=既存アカウント）
  const [mode, setMode] = useState<'signup' | 'login'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // マウント時に招待を検証してチーム名を表示（無効リンクは参加ボタンを押す前に判明・未ログイン可）
  useEffect(() => {
    if (!token) return
    previewInvite(token)
      .then((r) => {
        setTeamName(r.teamName)
        setState('confirm')
      })
      .catch((e) => {
        setMessage(e instanceof Error ? e.message : String(e))
        setState('error')
      })
  }, [token])

  async function handleJoin() {
    if (!token) return
    setState('joining')
    try {
      const r = await joinTeam(token)
      setTeamName(r.teamName)
      setState('done')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  // 参加後はチーム依存の store（teamStore のクォータ/チーム・生成の team 記帳先）を確実に
  // 再初期化するため、SPA 遷移ではなくフルリロードで /team へ移動する。
  function goTeam() {
    window.location.href = '/team'
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setFormError(null)
    if (password.length < 8) {
      setFormError('パスワードは8文字以上にしてください')
      return
    }
    setSubmitting(true)
    try {
      const r = await signupAndJoin(token, email.trim(), password)
      setTeamName(r.teamName)
      // 作成した資格情報でそのままログイン（失敗してもアカウント作成+参加は成立している）
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        setMode('login')
        setFormError('アカウントを作成しました。ログインしてください')
        return
      }
      setState('done')
    } catch (err) {
      const e = err as Error & { code?: string }
      if (e.code === 'already_registered') setMode('login')
      setFormError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setSubmitting(false)
    if (error) setFormError('メールアドレスまたはパスワードが正しくありません')
    // 成功時は useAuth の user が更新され、ログイン済みの確認表示（参加する）に切り替わる
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-canvas)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }

  return (
    <div className="flex items-center justify-center h-screen w-full" style={{ background: 'var(--bg-canvas)' }}>
      <div
        className="flex flex-col items-center gap-4 w-[360px] rounded-2xl px-8 py-10"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        {state === 'loading' || (state === 'confirm' && authLoading) ? (
          <>
            <CircleNotch size={28} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>招待リンクを確認中...</p>
          </>
        ) : state === 'done' ? (
          <>
            <CheckCircle size={40} weight="fill" style={{ color: 'var(--success)' }} />
            <p className="text-[15px] font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
              {teamName ? `${teamName} に参加しました` : 'チームに参加しました'}
            </p>
            <button
              onClick={goTeam}
              className="mt-2 px-4 py-2 rounded-lg text-[13px] font-medium"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              チームを開く
            </button>
          </>
        ) : state === 'error' ? (
          <>
            <XCircle size={40} weight="fill" style={{ color: 'var(--accent-error)' }} />
            <p className="text-[14px] text-center" style={{ color: 'var(--text-primary)' }}>{message ?? '参加できませんでした'}</p>
            <button
              onClick={() => navigate('/projects')}
              className="mt-2 px-4 py-2 rounded-lg text-[13px]"
              style={{ background: 'transparent', border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }}
            >
              ホームへ
            </button>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)' }}>
              <UsersThree size={26} weight="fill" style={{ color: '#6366F1' }} />
            </div>
            <p className="text-[15px] font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
              {teamName ? `「${teamName}」に参加しますか？` : 'チームへの招待'}
            </p>

            {user ? (
              // ログイン済み: opt-in 確認
              <>
                <p className="text-[12px] text-center leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  参加すると、現在のワークスペースからこのチームに切り替わります。
                </p>
                <button
                  onClick={handleJoin}
                  disabled={state === 'joining' || !token}
                  className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium disabled:opacity-60"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {state === 'joining' ? <CircleNotch size={15} className="animate-spin" /> : null}
                  参加する
                </button>
                <button onClick={() => navigate('/projects')} className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                  キャンセル
                </button>
              </>
            ) : (
              // 未ログイン: アカウント作成（invite-gated signup）or ログイン
              <>
                <div
                  className="flex w-full p-0.5 rounded-lg text-[12px] font-medium"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  {(['signup', 'login'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMode(m); setFormError(null) }}
                      className="flex-1 py-1.5 rounded-md transition-colors"
                      style={mode === m
                        ? { background: 'var(--bg-surface)', color: 'var(--text-primary)' }
                        : { background: 'transparent', color: 'var(--text-tertiary)' }}
                    >
                      {m === 'signup' ? 'アカウント作成' : 'ログイン'}
                    </button>
                  ))}
                </div>
                <form onSubmit={mode === 'signup' ? handleSignup : handleLogin} className="w-full flex flex-col gap-2">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="メールアドレス"
                    autoComplete="email"
                    className="w-full text-[13px] rounded-lg px-3 py-2 outline-none"
                    style={inputStyle}
                  />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'パスワード（8文字以上）' : 'パスワード'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    className="w-full text-[13px] rounded-lg px-3 py-2 outline-none"
                    style={inputStyle}
                  />
                  {formError && (
                    <p className="text-[12px]" style={{ color: '#EF4444' }}>{formError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="mt-1 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium disabled:opacity-60"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    {submitting ? <CircleNotch size={15} className="animate-spin" /> : null}
                    {mode === 'signup' ? 'アカウントを作成して参加' : 'ログインする'}
                  </button>
                </form>
                <p className="text-[11px] text-center leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  {mode === 'signup'
                    ? '参加すると、このチームのワークスペースが利用できます。'
                    : 'ログイン後、このチームへの参加を確認します。'}
                </p>
                {/* 規約同意（AuthModal と同一の同意導線・新規タブ） */}
                <p className="text-[11px] text-center leading-[1.7]" style={{ color: 'var(--text-tertiary)' }}>
                  アカウントを作成・ログインすることで、
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>利用規約</a>
                  および
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>プライバシーポリシー</a>
                  に同意したものとみなされます。
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
