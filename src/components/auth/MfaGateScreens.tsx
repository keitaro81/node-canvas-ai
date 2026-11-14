// 2 段階認証の関門の画面（2026-11-14）。AuthGuard が、ログイン済みで 2 段階目が要るときに出す。
//   MfaChallengeScreen = 認証アプリを登録済みの人のコード入力
//   MfaEnrollScreen    = 所属チームが必須にしているのに未登録の人の登録（終わるまで他の画面は使えない）
// どちらも「ここを通らないと画面が出ない」だけで、強制そのものはサーバー側にある。
import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useMfaStore } from '../../stores/mfaStore'
import { mfaErrorMessage, verifyTotp } from '../../lib/api/mfa'
import { MfaCodeInput, MfaEnrollPanel } from './MfaEnrollPanel'

function Shell({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  const signOut = useAuthStore((s) => s.signOut)
  const email = useAuthStore((s) => s.user?.email ?? '')
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 overflow-auto py-8" style={{ background: 'var(--bg-canvas)' }}>
      <div className="w-[400px] max-w-[calc(100vw-32px)] rounded-[12px] border border-[var(--border)] p-8 flex flex-col gap-5" style={{ background: 'var(--bg-surface)' }}>
        <div className="flex flex-col items-center gap-2">
          <ShieldCheck size={28} style={{ color: 'var(--accent)' }} />
          <span className="text-[17px] font-semibold text-[var(--text-primary)]">{title}</span>
          <span className="text-[12px] text-center leading-relaxed text-[var(--text-secondary)] [text-wrap:balance]">{lead}</span>
        </div>
        {children}
        <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <span className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }} title={email}>{email}</span>
          <button type="button" onClick={() => void signOut()} className="text-[12px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}

/** ログイン後のコード入力 */
export function MfaChallengeScreen() {
  const factors = useMfaStore((s) => s.factors)
  const refresh = useMfaStore((s) => s.refresh)
  const [picked, setPicked] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const factorId = picked && factors.some((f) => f.id === picked) ? picked : factors[0]?.id ?? null

  async function submit(value: string) {
    if (busy || value.length !== 6) return
    if (!factorId) { setError('認証アプリの登録を読み込めませんでした。画面を読み込み直してください'); return }
    setBusy(true)
    setError(null)
    try {
      await verifyTotp(factorId, value)
      await refresh(true)
    } catch (err) {
      setError(mfaErrorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="2 段階認証" lead="認証アプリに表示されている 6 桁のコードを入力してください。">
      {factors.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>使う認証アプリ</label>
          <select
            value={factorId ?? ''}
            onChange={(e) => setPicked(e.target.value)}
            className="rounded-md px-3 py-2 text-[13px] outline-none border"
            style={{ background: 'var(--bg-canvas)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {factors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      )}
      <MfaCodeInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} disabled={busy} autoFocus />
      {error && <p className="text-[12px]" style={{ color: 'var(--accent-error)' }}>{error}</p>}
      <button
        type="button"
        onClick={() => void submit(code)}
        disabled={busy || code.length !== 6}
        className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-[8px] text-[13px] font-medium disabled:opacity-40"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {busy && <Loader2 size={13} className="animate-spin" />}
        確認
      </button>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        認証アプリを使えなくなった場合は、チームのオーナーにリセットを依頼してください（オーナーご本人の場合は運営へ）。
      </p>
    </Shell>
  )
}

/** チームが必須にしているのに未登録の人: 登録が終わるまでここから先へ進めない */
export function MfaEnrollScreen() {
  const refresh = useMfaStore((s) => s.refresh)
  return (
    <Shell title="2 段階認証の設定が必要です" lead="所属しているチームが 2 段階認証を必須にしています。認証アプリを登録すると、続けて使えます。">
      <MfaEnrollPanel existingCount={0} onDone={() => void refresh(true)} />
    </Shell>
  )
}
