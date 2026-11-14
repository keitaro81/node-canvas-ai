// Account の「2 段階認証」の欄（2026-11-14）。認証アプリの登録・予備の追加・削除。
import { useEffect, useState } from 'react'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { useMfaStore } from '../../stores/mfaStore'
import { mfaErrorMessage, removeFactor } from '../../lib/api/mfa'
import { showToast } from '../../hooks/useToast'
import { MfaEnrollPanel } from '../auth/MfaEnrollPanel'

function dateLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

export function MfaSettingsSection() {
  const factors = useMfaStore((s) => s.factors)
  const requiredByTeam = useMfaStore((s) => s.requiredByTeam)
  const refresh = useMfaStore((s) => s.refresh)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 開いたときに取り直す（他の端末での登録・オーナーの切り替えを反映）
  useEffect(() => { void refresh(true) }, [refresh])

  const enabled = factors.length > 0
  // チームが必須のとき、最後の 1 つは消せない（消すと次の操作で登録し直しになるだけなので、先に予備を足してもらう）
  const lastOneLocked = requiredByTeam && factors.length === 1

  async function handleRemove(id: string, name: string) {
    // 2 つ以上あるとき: いまのログインで使った方を消すと、Auth サーバーがこのセッションを 1 段階目に戻すので、
    // 続けて残りの認証アプリのコード入力になる（どちらで通したかは画面からは分からないので、先に伝えておく）
    const warn = factors.length === 1
      ? `「${name}」を削除すると、2 段階認証が無効になります。削除しますか？`
      : `「${name}」を削除しますか？\n\nいまのログインで使った認証アプリを削除した場合は、続けて残りの認証アプリのコードを入力します。`
    if (!confirm(warn)) return
    setBusyId(id)
    try {
      await removeFactor(id)
      await refresh(true)
      showToast('認証アプリを削除しました', 'success')
    } catch (err) {
      showToast(mfaErrorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Two-Factor Authentication
      </h2>
      <div className="rounded-xl border px-4 py-4 flex flex-col gap-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="shrink-0 mt-0.5" style={{ color: enabled ? '#22C55E' : 'var(--text-tertiary)' }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                2 段階認証: {enabled ? '有効' : '無効'}
              </span>
              {requiredByTeam && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>
                  チームで必須
                </span>
              )}
            </div>
            <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              ログインのときに、パスワード（または Google）に加えて、認証アプリの 6 桁のコードを求めます。
              同じ端末では、ログアウトするまで入力し直す必要はありません。
            </p>
          </div>
        </div>

        {enabled && (
          <div className="flex flex-col rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {factors.map((f, i) => (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>登録日 {dateLabel(f.createdAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemove(f.id, f.name)}
                  disabled={busyId !== null || lastOneLocked}
                  className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30"
                  style={{ color: 'var(--text-tertiary)' }}
                  title={lastOneLocked ? 'チームが 2 段階認証を必須にしているため、最後の 1 つは削除できません（先に予備を追加してください）' : '削除'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <div className="pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <MfaEnrollPanel
              existingCount={factors.length}
              onCancel={() => setAdding(false)}
              onDone={() => {
                setAdding(false)
                void refresh(true)
                showToast(enabled ? '予備の認証アプリを追加しました' : '2 段階認証を有効にしました', 'success')
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="self-start px-4 py-2 rounded-lg text-[13px] font-medium"
              style={enabled
                ? { background: 'transparent', border: '1px solid var(--border-active)', color: 'var(--text-primary)' }
                : { background: 'var(--accent)', color: '#fff' }}
            >
              {enabled ? '予備の認証アプリを追加' : '有効にする'}
            </button>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              {enabled
                ? '端末をなくしたときに備えて、別の端末やアプリにも登録しておくことをおすすめします。使えなくなった場合は、チームのオーナー（オーナーご本人は運営）がリセットできます。'
                : '有効にすると、ほかの端末ではログインし直しになります。'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
