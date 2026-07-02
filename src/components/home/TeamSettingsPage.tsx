import { useState, useEffect, useCallback } from 'react'
import { CircleNotch, Copy, Check, Crown, Trash, ArrowsClockwise, SignOut } from '@phosphor-icons/react'
import {
  getTeamInfo,
  createInvite,
  removeMember,
  setMemberRole,
  leaveTeam,
  inviteUrl,
  type TeamInfo,
} from '../../lib/api/team'

export function TeamSettingsPage() {
  const [info, setInfo] = useState<TeamInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      setInfo(await getTeamInfo())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const isOwner = info?.myRole === 'owner'
  const isSolo = (info?.members.length ?? 0) <= 1

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>チーム設定</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {info?.teamName ? `${info.teamName}` : 'メンバーと招待の管理'}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : !info ? (
          <p className="text-[13px]" style={{ color: 'var(--accent-error)' }}>{error ?? 'チーム情報を取得できませんでした'}</p>
        ) : (
          <div className="max-w-[680px] flex flex-col gap-8">
            {error && (
              <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}

            {/* 招待リンク（owner のみ） */}
            {isOwner && (
              <section className="flex flex-col gap-3">
                <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>招待リンク</h2>
                <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                  このリンクを渡すと、相手が開いて参加できます（7日間有効・1本のみ）。
                </p>
                {info.invite ? (
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteUrl(info.invite.token)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 text-[12px] rounded-lg px-3 py-2 outline-none font-mono"
                      style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                    />
                    <button
                      onClick={() => handleCopy(inviteUrl(info.invite!.token))}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium shrink-0"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
                      {copied ? 'コピー済み' : 'コピー'}
                    </button>
                    <button
                      onClick={() => run(async () => { await createInvite() })}
                      disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] shrink-0 disabled:opacity-50"
                      style={{ background: 'transparent', border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }}
                      title="再発行（旧リンクは無効になります）"
                    >
                      <ArrowsClockwise size={13} />
                      再発行
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => run(async () => { await createInvite() })}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-medium self-start disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    {busy ? <CircleNotch size={13} className="animate-spin" /> : <Copy size={13} />}
                    招待リンクを発行
                  </button>
                )}
              </section>
            )}

            {/* メンバー一覧 */}
            <section className="flex flex-col gap-3">
              <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                メンバー（{info.members.length}）
              </h2>
              <div className="flex flex-col rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                {info.members.map((m, i) => (
                  <div
                    key={m.userId}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)', background: 'var(--bg-surface)' }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-semibold shrink-0" style={{ background: '#7C3AED', color: '#fff' }}>
                      {(m.email?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>
                        {m.email ?? m.userId}
                        {m.isMe && <span className="text-[11px] ml-1.5" style={{ color: 'var(--text-tertiary)' }}>（あなた）</span>}
                      </p>
                    </div>
                    {/* role バッジ */}
                    <span
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
                      style={m.role === 'owner'
                        ? { background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }
                        : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      {m.role === 'owner' && <Crown size={11} weight="fill" />}
                      {m.role === 'owner' ? 'Owner' : 'Member'}
                    </span>
                    {/* owner の操作（自分以外） */}
                    {isOwner && !m.isMe && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => run(() => setMemberRole(m.userId, m.role === 'owner' ? 'member' : 'owner'))}
                          disabled={busy}
                          className="px-2 py-1 rounded-lg text-[11px] disabled:opacity-50"
                          style={{ background: 'transparent', border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }}
                          title={m.role === 'owner' ? 'member に降格' : 'owner に昇格'}
                        >
                          {m.role === 'owner' ? 'member に' : 'owner に'}
                        </button>
                        <button
                          onClick={() => { if (confirm(`${m.email ?? 'このメンバー'} をチームから削除しますか？`)) void run(() => removeMember(m.userId)) }}
                          disabled={busy}
                          className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50"
                          style={{ color: 'var(--text-tertiary)' }}
                          title="削除"
                        >
                          <Trash size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* 離脱（複数人チームのみ） */}
            {!isSolo && (
              <section>
                <button
                  onClick={() => { if (confirm('このチームを離脱しますか？（個人チームに戻ります）')) void run(() => leaveTeam()) }}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] disabled:opacity-50"
                  style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}
                >
                  <SignOut size={13} />
                  チームを離脱
                </button>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
