import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { CheckCircle, CircleNotch, Warning, X } from '@phosphor-icons/react'
import { useBatchStore } from '../../stores/batchStore'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import {
  batchCreate, batchDryRun, batchItemsFromNode, buildWorkflowSnapshot, submitJobFully,
  type BatchLimits, type BatchPlanInfo, type CreateItemInput, type SubmitResult, type WorkflowSnapshot,
} from '../../lib/api/batch'
import { formatCost, formatDuration } from '../../lib/batch/cost'
import type { NodeData } from '../../types/nodes'

type Phase = 'estimating' | 'confirm' | 'creating' | 'submitting' | 'done' | 'error'

interface ApiError extends Error { code?: string; status?: number; details?: Record<string, unknown> }

const ROW = 'flex items-center justify-between text-[12px] py-1'

/**
 * 一括実行の確認 → 作成 → 投入（仕様 4-7 / 4-8）。Batch Input ノードの「一括実行…」から開く。
 * 枚数・推定時間・本日の残り枚数・警告を出し、原価はワークスペース設定が「見せる」のときだけ。
 */
export function BatchSubmitDialog() {
  const nodeId = useBatchStore((s) => s.submitDialogNodeId)
  const close = useBatchStore((s) => s.closeSubmitDialog)
  const bump = useBatchStore((s) => s.bump)
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('estimating')
  const [items, setItems] = useState<CreateItemInput[]>([])
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null)
  const [limits, setLimits] = useState<BatchLimits | null>(null)
  const [plan, setPlan] = useState<BatchPlanInfo | null>(null)
  const [name, setName] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<SubmitResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const running = useRef(false)

  // 開いたら見積（dryRun）
  useEffect(() => {
    if (!nodeId) return
    const { nodes, edges } = useCanvasStore.getState()
    const node = nodes.find((n) => n.id === nodeId)
    const its = batchItemsFromNode(node?.data as NodeData | undefined)
    const snap = buildWorkflowSnapshot(nodes, edges)
    setItems(its); setSnapshot(snap); setName(''); setJobId(null); setProgress(null); setErrorMsg(null); setPhase('estimating')
    let alive = true
    batchDryRun({ items: its, workflowSnapshot: snap })
      .then((r) => { if (!alive) return; setLimits(r.limits); setPlan(r.plan); setPhase('confirm') })
      .catch((e: ApiError) => {
        if (!alive) return
        const lim = e.details?.limits as BatchLimits | undefined
        if (lim) setLimits(lim)
        setErrorMsg(e.message); setPhase('error')
      })
    return () => { alive = false }
  }, [nodeId])

  const busy = phase === 'creating' || phase === 'submitting'
  useEffect(() => {
    if (!nodeId) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [nodeId, busy, close])

  if (!nodeId) return null

  async function runSubmit(id: string) {
    setPhase('submitting')
    try {
      const last = await submitJobFully(id, (r) => setProgress(r))
      if (!last.done) throw new Error(`投入が完了しませんでした（未投入 ${last.pendingTasks} 件・未コピー ${last.pendingCopies} 件）。「投入を再開」で続けられます`)
      setPhase('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setPhase('error')
    } finally {
      bump()
    }
  }

  async function start() {
    if (running.current || !snapshot) return
    running.current = true
    setErrorMsg(null)
    setPhase('creating')
    try {
      // 投入元ワークフローを記録する（バリアント = そのワークフローの Product Layout ノード、と連動させるため）
      const r = await batchCreate({ name: name.trim() || undefined, items, workflowSnapshot: snapshot, workflowId: useWorkflowStore.getState().currentWorkflowId })
      setJobId(r.jobId); setLimits(r.limits); setPlan(r.plan)
      bump()
      await runSubmit(r.jobId)
    } catch (e) {
      const err = e as ApiError
      const lim = err.details?.limits as BatchLimits | undefined
      if (lim) setLimits(lim)
      setErrorMsg(err.message); setPhase('error')
    } finally {
      running.current = false
    }
  }

  const submittedSoFar = progress ? progress.totalTasks - progress.pendingTasks : 0
  const remainingAfter = limits ? limits.remaining - items.length : null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close() }}>
      <div role="dialog" aria-modal="true" className="w-[480px] max-w-[92vw] rounded-xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>一括実行</h2>
          <button onClick={close} disabled={busy} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] disabled:opacity-40" style={{ color: 'var(--text-secondary)' }} title="閉じる"><X size={14} /></button>
        </div>

        {phase === 'estimating' && (
          <div className="flex items-center gap-2 py-8 justify-center text-[12px]" style={{ color: 'var(--text-secondary)' }}><CircleNotch size={16} className="animate-spin" />上限と見積を確認しています…</div>
        )}

        {(phase === 'confirm' || phase === 'creating' || phase === 'submitting' || phase === 'done' || phase === 'error') && (
          <div className="mt-3" style={{ color: 'var(--text-secondary)' }}>
            <div className={ROW}><span>枚数</span><b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{items.length} 枚</b></div>
            {plan && <div className={ROW}><span>AI 処理</span><span className="tabular-nums">{plan.totalTasks} 件（アイテムごと {plan.itemTasks} 種{plan.jobTasks ? `・ジョブごと ${plan.jobTasks} 件` : ''}）</span></div>}
            {plan && <div className={ROW}><span>推定時間</span><span>{formatDuration(plan.estimatedSeconds)}</span></div>}
            {limits && (
              <div className={ROW}>
                <span>本日の残り枚数</span>
                <span className="tabular-nums">{limits.remaining} 枚 → 実行後 <b style={{ color: remainingAfter !== null && remainingAfter < 0 ? '#EF4444' : 'var(--text-primary)' }}>{remainingAfter}</b> 枚（上限 {limits.dailyLimit}）</span>
              </div>
            )}
            {limits && <div className={ROW}><span>同時進行のジョブ</span><span className="tabular-nums">{limits.activeJobs} / {limits.maxActiveJobs}</span></div>}
            {plan?.showCost && <div className={ROW}><span>推定コスト</span><span className="tabular-nums">{formatCost(plan.estimatedCostUsd)}</span></div>}
            {plan?.warnings.length ? (
              <div className="mt-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: '#F59E0B' }}>
                {plan.warnings.map((w, i) => <div key={i} className="flex items-start gap-1"><Warning size={12} weight="fill" className="mt-0.5 shrink-0" />{w}</div>)}
              </div>
            ) : null}
          </div>
        )}

        {phase === 'confirm' && (
          <>
            <label className="block mt-3 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              ジョブ名（任意）
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="未入力なら「日時 + 枚数」"
                className="mt-1 w-full h-8 rounded-md px-2 text-[12px] outline-none"
                style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>投入が終わるまでこの画面を閉じないでください。投入後は処理が裏側で続き、ブラウザを閉じても構いません。</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={close} className="px-3 h-8 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>キャンセル</button>
              <button onClick={() => void start()} disabled={!items.length || !plan?.totalTasks} className="px-4 h-8 rounded-lg text-[12px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                {items.length} 枚を投入する
              </button>
            </div>
          </>
        )}

        {(phase === 'creating' || phase === 'submitting') && (
          <div className="mt-4">
            <div className="h-1.5 rounded overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
              <div className="h-full transition-all" style={{ width: `${progress?.totalTasks ? (submittedSoFar / progress.totalTasks) * 100 : 5}%`, background: 'var(--accent)' }} />
            </div>
            <div className="flex items-center gap-2 mt-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <CircleNotch size={14} className="animate-spin" />
              {phase === 'creating' ? 'ジョブを作成しています…' : `投入中 ${submittedSoFar} / ${progress?.totalTasks ?? plan?.totalTasks ?? '?'} 件${progress?.pendingCopies ? `（元画像のコピー 残り ${progress.pendingCopies}）` : ''}`}
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: '#22C55E' }}><CheckCircle size={18} weight="fill" />投入が完了しました</div>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>ブラウザを閉じても処理は続きます。進み具合はジョブ管理画面で確認できます。</p>
            {progress?.copyFailures.length ? <p className="mt-1 text-[11px]" style={{ color: '#F59E0B' }}>コピーできなかった元画像: {progress.copyFailures.join(', ')}</p> : null}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={close} className="px-3 h-8 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>閉じる</button>
              <button onClick={() => { close(); navigate(jobId ? `/jobs/${jobId}` : '/jobs') }} className="px-4 h-8 rounded-lg text-[12px] font-medium text-white" style={{ background: 'var(--accent)' }}>ジョブ管理へ</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-4">
            <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444' }}>{errorMsg}</div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={close} className="px-3 h-8 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>閉じる</button>
              {jobId
                ? <button onClick={() => void runSubmit(jobId)} className="px-4 h-8 rounded-lg text-[12px] font-medium text-white" style={{ background: 'var(--accent)' }}>投入を再開</button>
                : <button onClick={() => navigate('/jobs')} className="px-4 h-8 rounded-lg text-[12px] font-medium text-white" style={{ background: 'var(--accent)' }}>ジョブ管理へ</button>}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
