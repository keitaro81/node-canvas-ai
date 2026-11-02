// チャットでワークフローを組む（2026-11-01・段階 1）: 目的を日本語で書く → LLM がノード構成（JSON）を返す → 検証して並べたものを「この構成で作る」。
// 曖昧なら質問が返るので答える。会話は LLM に毎回まとめて渡す（エンドポイントは履歴を持たない）。費用は usage.cost を足し上げて表示
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChatCircleText, CircleNotch, PaperPlaneRight, X } from '@phosphor-icons/react'
import { AGENT_MAX_TURNS, askBuilder, type AgentTurnResult } from '../../lib/agent/client'
import type { AgentTurn } from '../../lib/agent/prompt'
import type { CompiledCanvas } from '../../lib/agent/compile'
import { catalogNode } from '../../lib/agent/catalog'
import { showToast } from '../../hooks/useToast'

interface Msg { role: 'user' | 'assistant'; text: string; result?: AgentTurnResult }
interface Props { open: boolean; onClose: () => void; onCreate: (canvas: CompiledCanvas, name: string) => Promise<void>; actionLabel?: string }

const STARTERS = ['商品写真の背景を白にして 1200×1200 で書き出したい', '商品写真をモデルに着せた着用画像を一括で作りたい', '服の正面と右側面の写真から、正面から右に回る商品動画を SKU ごとに作りたい']
const usd = (n: number | null) => (n === null ? '—' : `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`)

export function AgentBuilderDialog({ open, onClose, onCreate, actionLabel = 'この構成で作る' }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !creating) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, busy, creating, onClose])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [msgs, busy])

  const turnsOf = (list: Msg[]): AgentTurn[] => list.map((m) => ({ role: m.role, content: m.role === 'assistant' ? (m.result?.text ?? m.text) : m.text }))
  const userTurns = msgs.filter((m) => m.role === 'user').length
  const totalCost = msgs.reduce((s, m) => s + (m.result?.usage.cost ?? 0), 0)
  const last = [...msgs].reverse().find((m) => m.role === 'assistant')?.result
  const ready = !!last?.compiled?.canvas && last.compiled.errors.length === 0

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    if (userTurns >= AGENT_MAX_TURNS) { showToast(`この会話の往復は ${AGENT_MAX_TURNS} 回までです。新しく開き直してください`, 'warning'); return }
    const next: Msg[] = [...msgs, { role: 'user', text: t }]
    setMsgs(next); setInput(''); setBusy(true)
    try {
      const r = await askBuilder(turnsOf(next))
      const summary = r.reply?.message ?? (r.parseError ? `応答を読めませんでした（${r.parseError}）` : '')
      setMsgs([...next, { role: 'assistant', text: summary, result: r }])
    } catch (e) {
      setMsgs([...next, { role: 'assistant', text: `エラー: ${e instanceof Error ? e.message : String(e)}` }])
    } finally { setBusy(false) }
  }

  const create = async () => {
    if (!last?.compiled?.canvas) return
    setCreating(true)
    try { await onCreate(last.compiled.canvas, last.compiled.name); setMsgs([]); setInput('') }
    catch (e) { showToast(e instanceof Error ? e.message : String(e), 'error') }
    finally { setCreating(false) }
  }

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy && !creating) onClose() }}>
      <div role="dialog" aria-modal="true" className="flex flex-col rounded-xl overflow-hidden" style={{ width: 'min(640px, 94vw)', height: 'min(720px, 90vh)', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.12)', color: '#8B5CF6' }}><ChatCircleText size={16} /></span>
            <div>
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>チャットで組む</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>作りたいものを日本語で書くと、ノードをつないだ構成を提案します（LLM の費用はこの会話で {usd(totalCost)}）</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy || creating} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] disabled:opacity-40" style={{ color: 'var(--text-secondary)' }} title="閉じる"><X size={14} /></button>
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-auto px-5 py-4 flex flex-col gap-3">
          {msgs.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>例えば、こんなふうに書けます。</p>
              {STARTERS.map((s) => (
                <button key={s} className="text-left rounded-lg px-3 py-2 text-[12px] hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed" style={m.role === 'user' ? { background: '#8B5CF6', color: '#fff' } : { background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                {m.result?.reply?.questions && (
                  <ul className="mt-1.5 list-disc pl-4">{m.result.reply.questions.map((q, j) => <li key={j}>{q}</li>)}</ul>
                )}
                {m.result?.compiled && (
                  <div className="mt-2 rounded-lg px-2.5 py-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <div className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{m.result.compiled.name}</div>
                    {m.result.compiled.canvas ? (
                      <ol className="mt-1 list-decimal pl-4 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {m.result.compiled.canvas.nodes.filter((n) => n.type !== 'groupNode').map((n) => <li key={n.id}>{catalogNode(String(n.data?.type ?? ''))?.label ?? String(n.data?.label ?? n.id)}{m.result?.compiled?.hints?.[n.id] ? <span style={{ color: 'var(--text-tertiary)' }}> — {m.result?.compiled?.hints?.[n.id]}</span> : null}</li>)}
                      </ol>
                    ) : null}
                    {m.result.compiled.canvas && <div className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>接続 {m.result.compiled.canvas.edges.length} 本</div>}
                    {m.result.compiled.errors.map((e, j) => <div key={j} className="text-[11px] mt-1" style={{ color: '#EF4444' }}>{e}</div>)}
                    {m.result.compiled.notes.map((n, j) => <div key={j} className="text-[11px] mt-1" style={{ color: '#F59E0B' }}>{n}</div>)}
                  </div>
                )}
                {m.result && <div className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{m.result.model.replace(/^anthropic\//, '')}・{usd(m.result.usage.cost)}{m.result.repaired ? '・検証エラーを 1 回直しました' : ''}</div>}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={14} className="animate-spin" />構成を考えています…</div>}
        </div>

        <div className="px-5 py-3 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 rounded-lg px-3 py-2 text-[12px] leading-relaxed resize-none focus:outline-none"
              style={{ minHeight: 44, maxHeight: 120, background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              placeholder={msgs.length ? '答えや追加の希望を書く（Enter で送信・Shift+Enter で改行）' : '作りたいものを書く（Enter で送信・Shift+Enter で改行）'}
              value={input} rows={2} disabled={busy || creating}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }}
            />
            <button className="h-9 px-3 rounded-lg text-[12px] font-medium text-white disabled:opacity-50 flex items-center gap-1" style={{ background: '#8B5CF6' }} disabled={busy || creating || !input.trim()} onClick={() => void send(input)}><PaperPlaneRight size={14} />送る</button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>構成は作ったあとで自由に組み替えられます</span>
            <button className="h-9 px-4 rounded-lg text-[13px] font-medium text-white disabled:opacity-50 flex items-center gap-2" style={{ background: '#EC4899' }} disabled={!ready || busy || creating} onClick={() => void create()}>
              {creating && <CircleNotch size={14} className="animate-spin" />}{actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
