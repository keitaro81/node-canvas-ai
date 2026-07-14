import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleNotch, Copy, Check, Buildings, Plus, ArrowLeft } from '@phosphor-icons/react'
import { listAdminBranches, provisionBranch, type AdminBranchList, type ProvisionResult } from '../../lib/api/admin'

// 運営（オペレーター）専用コンソール（Tier 1）。ADMIN_USER_IDS に載る運営のみアクセス可（サーバーで 403）。
// 通常ナビには出さない独立ルート（/admin）。チームセットアップ＋全チーム一覧。

const APP_URL = 'https://node-canvas-ai.vercel.app'

function ownerTemplate(teamName: string, email: string): string {
  return [
    '【Node Canvas AI】アカウント準備のご案内',
    '',
    `チーム「${teamName}」の管理者アカウントを作成しました。`,
    '',
    `1. 下記を開き、「パスワードをお忘れの方」から ${email} でパスワードを設定してください。`,
    `   ${APP_URL}`,
    '2. ログイン後、左メニュー「Team」→「メンバー管理」→「招待リンクを発行」でメンバー用リンクを取得できます。',
    '3. そのリンクをチームメンバーに配布してください（メンバーはリンクから登録・参加できます）。',
    '',
    '※ 招待リンクは7日間有効・最新1本のみ有効です。生成回数の上限はチーム全体で共有されます。',
  ].join('\n')
}

export function AdminPage() {
  const navigate = useNavigate()
  const [list, setList] = useState<AdminBranchList | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // フォーム
  const [teamName, setTeamName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [quotaImage, setQuotaImage] = useState(100)
  const [quotaVideo, setQuotaVideo] = useState(7)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<ProvisionResult | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      setList(await listAdminBranches())
      setDenied(false)
      setError(null)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 403) setDenied(true)
      else setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setDone(null)
    if (!teamName.trim() || !ownerEmail.trim()) { setFormError('チーム名と owner メールを入力してください'); return }
    setSubmitting(true)
    try {
      const r = await provisionBranch({ teamName: teamName.trim(), ownerEmail: ownerEmail.trim(), quotaImage, quotaVideo })
      setDone(r)
      setTeamName(''); setOwnerEmail(''); setQuotaImage(100); setQuotaVideo(7)
      await load()
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle: React.CSSProperties = { background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-canvas)' }}>
        <CircleNotch size={28} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    )
  }

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4" style={{ background: 'var(--bg-canvas)' }}>
        <p className="text-[15px]" style={{ color: 'var(--text-primary)' }}>このページへのアクセス権がありません</p>
        <button onClick={() => navigate('/projects')} className="px-4 py-2 rounded-lg text-[13px]"
          style={{ background: 'transparent', border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }}>
          ホームへ
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-canvas)' }}>
      <div className="max-w-[900px] mx-auto px-6 py-8">
        <button onClick={() => navigate('/projects')} className="flex items-center gap-1.5 text-[12px] mb-4" style={{ color: 'var(--text-tertiary)' }}>
          <ArrowLeft size={13} /> ホーム
        </button>
        <div className="flex items-center gap-2 mb-1">
          <Buildings size={20} style={{ color: 'var(--accent)' }} />
          <h1 className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>運営コンソール</h1>
        </div>
        <p className="text-[12px] mb-6" style={{ color: 'var(--text-tertiary)' }}>
          チームのセットアップと一覧。運営のみアクセス可。{list?.period ? `今月: ${list.period}` : ''}
        </p>

        {error && <p className="text-[13px] mb-4" style={{ color: 'var(--accent-error)' }}>{error}</p>}

        {/* チームセットアップ */}
        <section className="rounded-xl p-5 mb-6" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <Plus size={14} /> チームを追加
          </h2>
          <form onSubmit={handleProvision} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>チーム名</span>
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="○○株式会社 △△チーム"
                  className="text-[13px] rounded-lg px-3 py-2 outline-none" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>owner メールアドレス</span>
                <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="manager@company.co.jp"
                  autoComplete="off" className="text-[13px] rounded-lg px-3 py-2 outline-none" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>画像クォータ / 月</span>
                <input type="number" min={0} value={quotaImage} onChange={(e) => setQuotaImage(Number(e.target.value))}
                  className="text-[13px] rounded-lg px-3 py-2 outline-none" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>動画クォータ / 月</span>
                <input type="number" min={0} value={quotaVideo} onChange={(e) => setQuotaVideo(Number(e.target.value))}
                  className="text-[13px] rounded-lg px-3 py-2 outline-none" style={inputStyle} />
              </label>
            </div>
            {formError && <p className="text-[12px]" style={{ color: 'var(--accent-error)' }}>{formError}</p>}
            <button type="submit" disabled={submitting}
              className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium disabled:opacity-60"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {submitting ? <CircleNotch size={14} className="animate-spin" /> : <Plus size={14} />}
              チームと owner を作成
            </button>
          </form>

          {done && (
            <div className="mt-4 rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <p className="text-[12px] mb-2" style={{ color: 'var(--success)' }}>
                ✓ 「{done.teamName}」を作成しました（owner: {done.ownerEmail}）。下記の案内文を owner に送ってください。
              </p>
              <pre className="text-[11px] whitespace-pre-wrap rounded-md p-3 mb-2" style={{ background: 'var(--bg-canvas)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
{ownerTemplate(done.teamName, done.ownerEmail)}
              </pre>
              <button onClick={() => { void navigator.clipboard.writeText(ownerTemplate(done.teamName, done.ownerEmail)); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
                style={{ background: 'transparent', border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }}>
                {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}{copied ? 'コピー済み' : '案内文をコピー'}
              </button>
            </div>
          )}
        </section>

        {/* チーム一覧 */}
        <section>
          <h2 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            チーム一覧（{list?.branches.length ?? 0}）
          </h2>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                  <th className="text-left font-medium px-3 py-2">チーム名</th>
                  <th className="text-left font-medium px-3 py-2">owner</th>
                  <th className="text-right font-medium px-3 py-2">人数</th>
                  <th className="text-right font-medium px-3 py-2">画像(今月/上限)</th>
                  <th className="text-right font-medium px-3 py-2">動画(今月/上限)</th>
                </tr>
              </thead>
              <tbody>
                {(list?.branches ?? []).map((b) => (
                  <tr key={b.teamId} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{b.name}</td>
                    <td className="px-3 py-2 truncate max-w-[220px]">{b.owners.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.memberCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: b.usedImage >= b.quotaImage ? 'var(--accent-error)' : undefined }}>{b.usedImage} / {b.quotaImage}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: b.usedVideo >= b.quotaVideo ? 'var(--accent-error)' : undefined }}>{b.usedVideo} / {b.quotaVideo}</td>
                  </tr>
                ))}
                {(list?.branches.length ?? 0) === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center" style={{ color: 'var(--text-tertiary)' }}>まだチームがありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
