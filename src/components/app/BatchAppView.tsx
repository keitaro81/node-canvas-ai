// 撮影後工程の App モード（フェーズ C(c)）: 左に「写真を追加」、右に「結果」（履歴から選ぶ）。
// ワークフローの中身（ノード）はキャンバスで組み、使う人はこの画面だけで 写真を入れる → 処理 → 確認 → ダウンロード を完結させる。
// 使う人には「ジョブ」という言葉を見せない（保存の単位としては batch_jobs のまま。2026-10-04 ユーザー決定）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowSquareOut, CaretDown, CaretUp, CircleNotch, Images, ListChecks } from '@phosphor-icons/react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useBatchStore, useWatchBatchJobs } from '../../stores/batchStore'
import { JobActions } from '../jobs/JobActions'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useLiveCanvas } from '../../hooks/useLiveCanvas'
import { fetchJob, fetchWorkflowJobs } from '../../lib/api/batchJobs'
import { buildWorkflowSnapshot, type CreateItemInput } from '../../lib/api/batch'
import { nodeLabelOf, pruneToEntry } from '../../lib/batch/plan'
import { appBatchPlanOf, appCanvasOf, appScopeOf, type AppBatchPlan } from '../../lib/apps/appKind'
import { kindLabel } from '../../lib/batch/kindLabel'
import { createReviewStoreHook } from '../../lib/review/reviewStore'
import { normalizeBatchInputParams } from '../../lib/batch/items'
import { jobLabel } from '../../lib/batch/jobLabel'
import type { BatchJobRow } from '../../types/batch'
import type { NodeData, BatchItem } from '../../types/nodes'
import { JobReviewPanel } from '../jobs/review/JobReviewPanel'
import { AppBatchInput } from './AppBatchInput'
import { clearAppPhotos } from '../../lib/batch/appPhotos'
import { AppLayoutSettings } from './AppLayoutSettings'
import { AppSettingsPanel } from './AppSettingsPanel'
import { useAppSettings } from '../../hooks/useAppSettings'
import { appSettingFieldsOf, appSettingsStorageKey, applyAppSettings } from '../../lib/apps/appSettings'

const ACCENT = '#14B8A6'

export function BatchAppView() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const workflowName = useWorkflowStore((s) => s.currentWorkflowName)
  const nodes = useCanvasStore((s) => s.nodes)
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const bump = useBatchStore((s) => s.bump)
  const openSubmitDialogWith = useBatchStore((s) => s.openSubmitDialogWith)
  const userId = useBatchStore((s) => s.userId)
  const memberNames = useBatchStore((s) => s.memberNames)
  // 履歴の 1 行: 他の人が実行した分だけ名前を添える（自分の分は日時・枚数・状態だけ）
  const labelOf = useCallback((j: BatchJobRow) => jobLabel(j, j.created_by && j.created_by !== userId ? (memberNames[j.created_by] ?? `${j.created_by.slice(0, 8)}…`) : null), [userId, memberNames])
  useWatchBatchJobs('batch-app')

  // App = App 化したグループ（段階 3）: グループの中の入口（Batch Input）を使い、計画もグループの中だけ。グループが無い既存ワークフローはキャンバス全体
  const capsuleGroupId = useCanvasStore((s) => s.capsuleGroupId)
  const scope = useMemo(() => appScopeOf({ capsuleGroupId, nodes: nodes.map((n) => ({ id: n.id, type: n.type, parentId: n.parentId, data: n.data as unknown as Record<string, unknown> })) }), [nodes, capsuleGroupId])
  const batchInput = useMemo(() => (scope.entryId ? nodes.find((n) => n.id === scope.entryId) ?? null : null), [nodes, scope.entryId])
  const skuPattern = useMemo(() => normalizeBatchInputParams((batchInput?.data as unknown as NodeData | undefined)?.params).skuPattern, [batchInput])

  const [searchParams] = useSearchParams()
  const jobParam = searchParams.get('job')          // ジョブ一覧から開いたとき: このジョブを選んだ状態で始める
  const [jobs, setJobs] = useState<BatchJobRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(jobParam)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const store = useMemo(() => createReviewStoreHook(), [])
  useEffect(() => () => store.getState().close(), [store])
  const liveCanvas = useLiveCanvas()
  // App の画面はすべて App 化したグループの中だけを見る（結果の列・背景・Export の設定・レイアウト設定。2026-11-02 メモ 45）
  const appCanvas = useMemo(() => appCanvasOf(liveCanvas.nodes ?? [], liveCanvas.edges ?? [], scope.groupId), [liveCanvas, scope.groupId])
  const hasLayoutParts = useMemo(() => appCanvas.nodes.some((n) => n.data?.type === 'removeBackground' || n.data?.type === 'productLayout'), [appCanvas])
  // 計画（処理内容）と、一括 App として動かせない理由（入口が 2 つ以上・画像と動画の混在・動画が 2 本以上。2026-11-02）
  const plan = useMemo(() => appBatchPlanOf({ capsuleGroupId, nodes: liveCanvas.nodes, edges: liveCanvas.edges }, scope.groupId), [liveCanvas, capsuleGroupId, scope.groupId])
  // 設定（メモ 46・使う人ごとに選ぶ）: 処理に使うモデル・画像・文をこの画面で選び直す。ブラウザに覚え、処理を始めるときに写しへ入れる
  const settingFields = useMemo(() => (plan ? appSettingFieldsOf(appCanvas.nodes, appCanvas.edges, plan.tasks.map((t) => t.nodeId)) : []), [plan, appCanvas])
  const [appSettings, setAppSettings] = useAppSettings(appSettingsStorageKey(workflowId, scope.entryId))
  // 「処理内容」は使う人が選んだ設定を重ねた計画で出す（実際に動く内容。モデルを変えたときの注意など・2026-11-02 メモ 67）。動かせるかの判定はキャンバスの計画のまま
  const shownPlan = useMemo(() => (plan && Object.keys(appSettings).length
    ? appBatchPlanOf({ capsuleGroupId, nodes: applyAppSettings(liveCanvas.nodes ?? [], appSettings, settingFields), edges: liveCanvas.edges }, scope.groupId) ?? plan
    : plan), [plan, appSettings, settingFields, liveCanvas, capsuleGroupId, scope.groupId])

  useEffect(() => {
    let alive = true
    ;(workflowId ? fetchWorkflowJobs(workflowId, 30, scope.entryId) : Promise.resolve([] as BatchJobRow[]))   // この App の入口から回した分だけ（メモ 45）
      .then(async (rows) => {
        // 一覧（最新 30 件）に無い古いジョブを指定して開いたときは、そのジョブだけ足す
        if (jobParam && !rows.some((j) => j.id === jobParam)) {
          const extra = await fetchJob(jobParam).catch(() => null)
          if (extra && extra.workflow_id === workflowId) rows = [extra, ...rows]
        }
        if (!alive) return
        setJobs(rows); setError(null)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [workflowId, jobsVersion, reloadTick, jobParam, scope.entryId])
  const current = useMemo(() => (jobs ? jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null : null), [jobs, selectedId])

  const submit = useCallback((items: CreateItemInput[]) => {
    const { nodes: all, edges: allEdges } = useCanvasStore.getState()
    const { nodes: ns, edges } = appCanvasOf(all, allEdges, scope.groupId)
    const withSettings = applyAppSettings(ns, appSettings, settingFields)   // 使う人が選んだモデル・画像・文（ワークフローは変えない）
    openSubmitDialogWith({
      items, snapshot: pruneToEntry(buildWorkflowSnapshot(withSettings, edges), batchInput?.id ?? null), workflowId,   // この入口の枝だけ（メモ 24）
      onDone: (jobId) => { clearAppPhotos(`${workflowId ?? 'draft'}:${batchInput?.id ?? ''}`); setResetKey((k) => k + 1); setSelectedId(jobId); setReloadTick((t) => t + 1); bump() },
    })
  }, [openSubmitDialogWith, workflowId, bump, batchInput?.id, scope.groupId, appSettings, settingFields])

  if (!batchInput || plan?.issue) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6" style={{ color: 'var(--text-secondary)' }}>
        <div className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>{plan?.issue ? 'この App はまだ動かせません' : 'この App には Batch Input がありません'}</div>
        {plan?.issue && <div className="text-[12px] max-w-[560px]" style={{ color: '#F59E0B' }}>{plan.issue.message}</div>}
        <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{plan?.issue ? 'キャンバスで App 化したグループの中を直すと、ここで写真の追加と結果の確認ができます。' : 'キャンバスで Batch Input → Remove Background → Product Layout を組むと、ここで写真の追加と結果の確認ができます。'}</div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: 'var(--bg-canvas)' }}>
      {shownPlan && <AppProcessing plan={shownPlan} />}
      <div className={`flex-1 min-h-0 flex ${isMobile ? 'flex-col overflow-auto' : 'flex-row'}`}>
        {/* 左: 写真を追加 */}
        <aside className={`${isMobile ? 'w-full' : 'w-[380px] shrink-0 overflow-auto border-r'} px-5 py-4`} style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Images size={16} style={{ color: ACCENT }} />
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>写真を追加</h2>
          </div>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
            入れた写真すべてに、App「{workflowName}」の処理（上の「処理内容」）を行います。
          </p>
          <AppBatchInput key={resetKey} nodeId={batchInput.id} skuPattern={skuPattern} canSubmit={!!workflowId} onSubmit={submit} storageKey={`${workflowId ?? 'draft'}:${batchInput.id}`} initialItems={(batchInput.data as unknown as NodeData).items as BatchItem[] | undefined} />
          {settingFields.length > 0 && (<>
            <div className="my-4 border-t" style={{ borderColor: 'var(--border)' }} />
            <AppSettingsPanel fields={settingFields} settings={appSettings} onChange={setAppSettings} workflowId={workflowId} />
          </>)}
          {hasLayoutParts && (<>
            <div className="my-4 border-t" style={{ borderColor: 'var(--border)' }} />
            <AppLayoutSettings groupId={scope.groupId} />
          </>)}
        </aside>

        {/* 右: 結果（履歴から選ぶ） */}
        <section className={`flex-1 min-w-0 min-h-0 flex flex-col ${isMobile ? 'border-t' : ''}`} style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-5 shrink-0 border-b" style={{ height: 44, borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
            <h2 className="text-[14px] font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>結果</h2>
            {jobs && jobs.length > 0 && (
              <label className="ml-2 flex items-center gap-1.5 flex-1 min-w-0 max-w-[560px] text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                履歴
                <select
                  className="flex-1 min-w-0 h-8 rounded-md px-2 text-[12px] outline-none"
                  style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  value={current?.id ?? ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                  title="履歴（この App で処理した分・新しい順）"
                >
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{labelOf(j)}</option>
                  ))}
                </select>
              </label>
            )}
            {current && <JobActions job={current} variant="menu" onChanged={bump} onDeleted={() => { setSelectedId(null); setReloadTick((t) => t + 1); bump() }} />}
            <div className="flex-1" />
            <button className="flex items-center gap-1 h-8 px-2.5 rounded-md hover:bg-[var(--bg-elevated)] text-[12px]" style={{ color: 'var(--text-secondary)' }} title="すべての App の履歴（運用）" onClick={() => navigate('/jobs')}>
              <ArrowSquareOut size={13} />すべての履歴
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            {jobs === null && !error && (
              <div className="flex items-center justify-center flex-1 gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={16} className="animate-spin" />結果を読み込み中…</div>
            )}
            {error && <div className="p-5 text-[12px]" style={{ color: '#EF4444' }}>結果を読み込めませんでした: {error}</div>}
            {jobs && jobs.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>まだ結果がありません</div>
                <div style={{ color: 'var(--text-tertiary)' }}>左で写真を追加して「…枚を処理する」を押すと、ここに結果が出ます。</div>
              </div>
            )}
            {current && (
              <JobReviewPanel key={current.id} jobId={current.id} store={store} mode="app" liveCanvas={appCanvas} onDeleted={() => { setSelectedId(null); setReloadTick((t) => t + 1); bump() }} />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/** 処理内容（2026-11-02 段階 4）: 写真ごとに何が何回動くか・全体で 1 回の処理・対象外のノードと理由・注意。ノードには印（BatchMark）だけを残し、理由はここにまとめる */
function AppProcessing({ plan }: { plan: AppBatchPlan }) {
  const [open, setOpen] = useState(false)
  const perItem = plan.tasks.filter((t) => t.scope === 'item')
  const perJob = plan.tasks.filter((t) => t.scope === 'job')
  const maxStage = perItem.reduce((m, t) => Math.max(m, t.stage), 1)
  const excluded = Object.entries(plan.excluded)
  const excludedReasons = new Set(Object.values(plan.excluded))
  const warnings = plan.warnings.filter((w) => !excludedReasons.has(w))   // 対象外の理由は「対象外」の欄に出す（重複させない）
  const others = plan.nodes.filter((n) => n.data?.type === 'productLayout' || n.data?.type === 'export').map((n) => nodeLabelOf(n))
  // 要約: 段ごとに「→」でつなぎ、同じ段の枝分かれは「・」、同じ名前は「× n」にまとめる（ノード名は種類名のままなので重複しやすい）
  const stageText = (ts: typeof perItem) => { const c = new Map<string, number>(); for (const t of ts) c.set(t.label, (c.get(t.label) ?? 0) + 1); return [...c].map(([l, n]) => (n > 1 ? `${l} × ${n}` : l)).join('・') }
  const summary = perItem.length ? [...new Set(perItem.map((t) => t.stage))].sort((x, y) => x - y).map((st) => stageText(perItem.filter((t) => t.stage === st))).join(' → ') : 'AI の処理なし'
  const count = excluded.length + warnings.length
  return (
    <div className="shrink-0 border-b px-5 py-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
      <button type="button" className="w-full flex items-center gap-2 text-left text-[12px] min-w-0" onClick={() => setOpen((o) => !o)}>
        <ListChecks size={14} className="shrink-0" style={{ color: ACCENT }} />
        <span className="font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>処理内容</span>
        <span className="truncate" style={{ color: 'var(--text-secondary)' }}>写真ごとに {summary}{others.length ? ` ＋ ${others.join('・')}` : ''}</span>
        {count > 0 && <span className="shrink-0 tabular-nums" style={{ color: '#F59E0B' }}>{excluded.length > 0 ? `対象外 ${excluded.length}` : ''}{excluded.length > 0 && warnings.length > 0 ? '・' : ''}{warnings.length > 0 ? `注意 ${warnings.length}` : ''}</span>}
        <span className="flex-1" />
        {open ? <CaretUp size={12} style={{ color: 'var(--text-tertiary)' }} /> : <CaretDown size={12} style={{ color: 'var(--text-tertiary)' }} />}
      </button>
      {open && (
        <div className="mt-2 grid gap-3 text-[11px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', color: 'var(--text-secondary)' }}>
          <div>
            <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>写真ごとに動く処理</div>
            {perItem.length ? (
              <ol className="list-decimal pl-4 flex flex-col gap-0.5">
                {perItem.map((t) => <li key={t.nodeId}>{t.label}<span style={{ color: 'var(--text-tertiary)' }}>（{kindLabel(t.kind)}{maxStage > 1 ? `・${t.stage} 段目` : ''}）</span></li>)}
              </ol>
            ) : <div style={{ color: 'var(--text-tertiary)' }}>AI の処理はありません</div>}
            {others.length > 0 && <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>そのほか: {others.join('・')}（レイアウトと書き出しは結果の画面で）</div>}
            {perJob.length > 0 && <div className="mt-1">全体で 1 回: {perJob.map((t) => `${t.label}（${kindLabel(t.kind)}）`).join('・')}</div>}
          </div>
          {excluded.length > 0 && (
            <div>
              <div className="font-medium mb-1" style={{ color: '#F59E0B' }}>一括の対象外</div>
              <ul className="list-disc pl-4 flex flex-col gap-0.5">{excluded.map(([id, reason]) => <li key={id}>{reason}</li>)}</ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <div className="font-medium mb-1" style={{ color: '#F59E0B' }}>注意</div>
              <ul className="list-disc pl-4 flex flex-col gap-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
