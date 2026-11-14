// 認証アプリ（TOTP）の登録の部品（2026-11-14）。Account の設定欄と、チーム必須のときの登録画面で共用する。
// 流れ: 名前を決める → QR コードを認証アプリで読む（読めなければキーを手で入れる）→ 6 桁のコードで確認 → 有効。
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cancelTotpEnroll, groupSecret, mfaErrorMessage, startTotpEnroll, verifyTotp, type TotpEnrollment } from '../../lib/api/mfa'

/** 6 桁のコードの入力欄（数字だけ・6 桁そろったら onComplete） */
export function MfaCodeInput({ value, onChange, onComplete, disabled, autoFocus }: {
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6)
        onChange(v)
        if (v.length === 6 && v !== value) onComplete?.(v)
      }}
      placeholder="000000"
      aria-label="6 桁のコード"
      className="w-full rounded-[6px] border px-3 py-2.5 text-center text-[20px] tabular-nums outline-none focus:border-[var(--border-active)] disabled:opacity-60"
      style={{ background: 'var(--bg-canvas)', borderColor: 'var(--border)', color: 'var(--text-primary)', letterSpacing: '0.35em' }}
    />
  )
}

interface Props {
  /** すでに登録済みの認証アプリの数（名前の初期値に使う） */
  existingCount: number
  /** 確認が済んで有効になった */
  onDone: () => void
  /** やめる（省略するとボタンを出さない） */
  onCancel?: () => void
}

export function MfaEnrollPanel({ existingCount, onDone, onCancel }: Props) {
  const [name, setName] = useState(existingCount > 0 ? `認証アプリ ${existingCount + 1}` : '認証アプリ')
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)

  // 確認の前に画面を離れたら、作りかけの登録を消す
  const pending = useRef<string | null>(null)
  useEffect(() => () => { if (pending.current) void cancelTotpEnroll(pending.current) }, [])

  async function start() {
    const trimmed = name.trim()
    if (!trimmed) { setError('名前を入力してください（例: iPhone の認証アプリ）'); return }
    setBusy(true)
    setError(null)
    try {
      const e = await startTotpEnroll(trimmed)
      pending.current = e.factorId
      setEnrollment(e)
    } catch (err) {
      setError(mfaErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(value: string) {
    if (!enrollment || busy || value.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      await verifyTotp(enrollment.factorId, value)
      pending.current = null
      onDone()
    } catch (err) {
      setError(mfaErrorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (pending.current) { await cancelTotpEnroll(pending.current); pending.current = null }
    onCancel?.()
  }

  const labelCls = 'text-[11px]'
  const secondaryBtn = 'px-3 py-2 rounded-lg text-[12px] disabled:opacity-50'

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          スマートフォンの認証アプリ（Google Authenticator・Microsoft Authenticator・1Password など）を使います。
          ログインのたびに、アプリに表示される 6 桁のコードを入力します。
        </p>
        <div className="flex flex-col gap-1.5">
          <label className={labelCls} style={{ color: 'var(--text-secondary)' }}>名前（どの端末・アプリか分かるように）</label>
          <input
            type="text"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md px-3 py-2 text-[13px] outline-none border focus:border-[var(--accent)]"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </div>
        {error && <p className="text-[12px]" style={{ color: 'var(--accent-error)' }}>{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            QR コードを表示
          </button>
          {onCancel && (
            <button type="button" onClick={() => void cancel()} disabled={busy} className={secondaryBtn} style={{ border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }}>
              やめる
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="text-[12px] leading-relaxed list-decimal pl-4" style={{ color: 'var(--text-secondary)' }}>
        <li>認証アプリで、下の QR コードを読み取ります。</li>
        <li>アプリに表示された 6 桁のコードを入力します。</li>
      </ol>
      <div className="flex flex-col items-center gap-2">
        {/* QR は白地でないと読み取れないことがあるので、テーマに関わらず白い枠に置く */}
        <div className="rounded-lg p-3" style={{ background: '#fff', border: '1px solid var(--border)' }}>
          <img src={enrollment.qr} alt="認証アプリで読み取る QR コード" width={176} height={176} draggable={false} />
        </div>
        <button type="button" onClick={() => setShowSecret((v) => !v)} className="text-[11px]" style={{ color: 'var(--accent)' }}>
          {showSecret ? 'キーを隠す' : 'QR コードを読み取れないとき（キーを手で入力）'}
        </button>
        {showSecret && (
          <code className="text-[12px] px-3 py-2 rounded-md select-all break-all text-center" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            {groupSecret(enrollment.secret)}
          </code>
        )}
      </div>
      <MfaCodeInput value={code} onChange={setCode} onComplete={(v) => void confirm(v)} disabled={busy} autoFocus />
      {error && <p className="text-[12px]" style={{ color: 'var(--accent-error)' }}>{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void confirm(code)}
          disabled={busy || code.length !== 6}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          確認して有効にする
        </button>
        {onCancel && (
          <button type="button" onClick={() => void cancel()} disabled={busy} className={secondaryBtn} style={{ border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }}>
            やめる
          </button>
        )}
      </div>
    </div>
  )
}
