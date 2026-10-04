// 一括結果ノード（フェーズ C(b)）: このワークフローから投入したジョブと、その確認グリッド（切り抜き・バリアント・生成結果）をキャンバス上で見る。
// 操作はジョブ管理画面と同じ（チェック・拡大・再度切り抜く・書き出し・キャンセル/再実行/削除）。レイアウトの変更だけはキャンバスの Product Layout ノードで行い、
// 変更はこのノードのサムネイルにその場で反映される（fal は呼ばない）。入出力ポートは無い。
import { memo, useEffect, useMemo, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { useNavigate } from 'react-router'
import { LayoutGrid, Loader2 } from 'lucide-react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useCanvasStore } from '../../stores/canvasStore'
import { useBatchStore, useWatchBatchJobs } from '../../stores/batchStore'
import { fetchWorkflowJobs } from '../../lib/api/batchJobs'
import { jobLabel } from '../../lib/batch/jobLabel'
import { createReviewStoreHook } from '../../lib/review/reviewStore'
import { useLiveCanvas } from '../../hooks/useLiveCanvas'
import type { BatchJobRow } from '../../types/batch'
import type { NodeData } from '../../types/nodes'
import { JobReviewPanel } from '../jobs/review/JobReviewPanel'

const ACCENT = '#14B8A6'
// 既定サイズ 820×620 は Canvas.tsx / FloatingToolbar.tsx の追加時に style で与える
const MIN_W = 560, MIN_H = 400

function BatchResultsNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as NodeData
  const navigate = useNavigate()
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const bump = useBatchStore((s) => s.bump)
  // App モードの間はキャンバスごと背面に隠れる。見えないのに描画・保存すると App の結果欄と同じサムネイルを二重に作る（Storage の重複 400）ので止める
  const hidden = useCanvasStore((s) => s.appMode) !== 'graph'
  useWatchBatchJobs(`results:${id}`)   // ノードがある間はジョブの変更を Realtime で追う

  const [jobs, setJobs] = useState<BatchJobRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // 確認グリッドの状態はノードごとに 1 つ（ジョブ管理画面や他のノードと混ざらない）。外すときに Worker と object URL を解放
  const store = useMemo(() => createReviewStoreHook(), [])
  useEffect(() => () => store.getState().close(), [store])
  useEffect(() => { if (hidden) store.getState().close() }, [hidden, store])

  useEffect(() => {
    let alive = true
    ;(workflowId ? fetchWorkflowJobs(workflowId) : Promise.resolve([] as BatchJobRow[]))
      .then((rows) => { if (!alive) return; setJobs(rows); setError(null) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [workflowId, jobsVersion, reloadTick])
  const current = useMemo(() => (jobs ? jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null : null), [jobs, selectedId])

  // キャンバスの現在のノード（バリアント・背景・Export 設定の出どころ）。位置の変化では更新しない
  const liveCanvas = useLiveCanvas()


  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ width: '100%', height: '100%', minWidth: MIN_W, minHeight: MIN_H, background: 'var(--bg-surface)', border: `1px solid ${selected ? ACCENT : 'var(--border)'}`, borderRadius: 12, boxShadow: selected ? `0 0 0 1px ${ACCENT}44` : 'none' }}
    >
      <NodeResizer minWidth={MIN_W} minHeight={MIN_H} isVisible={selected} lineStyle={{ stroke: ACCENT, strokeWidth: 1 }} handleStyle={{ background: ACCENT, border: 'none', borderRadius: 3, width: 8, height: 8 }} />
      {/* ヘッダー: タイトル・ジョブの選択・再読込 */}
      <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 36, borderBottom: '1px solid var(--border)' }}>
        <LayoutGrid size={14} style={{ color: ACCENT, flexShrink: 0 }} />
        <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{nodeData.label || 'Batch Results'}</span>
        {jobs && jobs.length > 0 && (
          <select
            className="nodrag ml-2 flex-1 min-w-0 h-7 rounded-md px-2 text-[11px] outline-none"
            style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            value={current?.id ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
            title="履歴（このワークフローで処理した分・新しい順）"
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{jobLabel(j)}</option>
            ))}
          </select>
        )}
      </div>
      {/* 本体: ジョブ管理画面と同じ確認グリッド。ノード内でスクロールし、キャンバスのドラッグ/ズームには流さない */}
      <div className="nodrag nowheel flex-1 min-h-0" style={{ cursor: 'default' }}>
        {jobs === null && !error && (
          <div className="flex items-center justify-center h-full gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}><Loader2 size={16} className="animate-spin" />結果を読み込み中…</div>
        )}
        {error && <div className="p-4 text-[12px]" style={{ color: '#EF4444' }}>結果を読み込めませんでした: {error}</div>}
        {jobs && jobs.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>このワークフローの一括実行はまだありません</div>
            <div style={{ color: 'var(--text-tertiary)' }}>Batch Input に写真を入れて「一括実行…」を押すと、ここに結果が出ます。他のメンバーの分は、ワークフローがチームに共有されていれば表示されます。</div>
            {workflowId ? null : <div style={{ color: '#F59E0B' }}>ワークフローを保存すると表示できるようになります</div>}
          </div>
        )}
        {current && !hidden && (
          <JobReviewPanel key={current.id} jobId={current.id} store={store} mode="node" liveCanvas={liveCanvas} onDeleted={() => { setSelectedId(null); setReloadTick((t) => t + 1); bump() }} />
        )}
      </div>
      {current && (
        <div className="px-3 py-1 text-[10px] shrink-0 border-t truncate" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
          クリックで選択・ダブルクリックで拡大・矢印キーで移動・Space でチェック。
          <button className="nodrag underline ml-1" onClick={() => navigate(workflowId ? `/app/${workflowId}?job=${current.id}` : `/jobs/${current.id}`)} style={{ color: 'var(--text-secondary)' }}>App で開く</button>
        </div>
      )}
    </div>
  )
}

export const BatchResultsNode = memo(BatchResultsNodeInner)
