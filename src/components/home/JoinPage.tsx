import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { CircleNotch, UsersThree, CheckCircle, XCircle } from '@phosphor-icons/react'
import { joinTeam, previewInvite } from '../../lib/api/team'

// 招待リンクの着地ページ（/join/:token）。AuthGuard 配下なので未ログインはログイン後にここへ戻る。
// opt-in: 自動参加せず、まず preview でチーム名を表示し「参加する」を押して初めて join する。
export function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  // token 無しは最初から error（effect 内の同期 setState を避けるため初期値で導出）
  const [state, setState] = useState<'loading' | 'confirm' | 'joining' | 'done' | 'error'>(() => (token ? 'loading' : 'error'))
  const [message, setMessage] = useState<string | null>(() => (token ? null : '無効な招待リンクです'))
  const [teamName, setTeamName] = useState<string | null>(null)

  // マウント時に招待を検証してチーム名を表示（無効リンクは参加ボタンを押す前に判明）
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

  return (
    <div className="flex items-center justify-center h-screen w-full" style={{ background: 'var(--bg-canvas)' }}>
      <div
        className="flex flex-col items-center gap-4 w-[360px] rounded-2xl px-8 py-10"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        {state === 'loading' ? (
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
        )}
      </div>
    </div>
  )
}
