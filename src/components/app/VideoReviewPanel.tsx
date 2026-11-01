// 動画の結果欄（2026-10-13）: 1 件 = 1 SKU。終端の動画（結合、無ければ生成）を再生・ダウンロードする。
// App（mode 'app'）と、履歴ページ / 一括結果ノード（JobReviewPanel が動画のジョブなら委譲）で共用。
// 終端 / ショットの判定: 新しいタスクは input.__terminal・__kind、旧ジョブ（Product Video ノード）は結合 = ノード id・ショット = <id>:shot:<i>
// 2026-11-01 決定: 結果欄は結合済み動画の再生・ダウンロードだけ（ショット別の表示とショット単位のやり直しは外した。作り直しはキャンバスの対話実行で）
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleNotch, DownloadSimple, Warning } from '@phosphor-icons/react'
import { exportParamsFromSnapshot, itemInfoOfRow } from '../../lib/review/model'
import { planExportEntries } from '../../lib/export/naming'
import { fetchJobDetail, fetchJobItems, fetchJobTasks, subscribeJobItems } from '../../lib/api/batchJobs'
import { signBatchPaths } from '../../lib/cutout/store'
import { useBatchStore } from '../../stores/batchStore'
import { parseShotTaskNodeId, videoNodeOf } from '../../lib/video/productVideo'
import { isTerminalVideoTask } from '../../lib/api/batchVideos'
import { isActiveJob, jobProgress } from '../../lib/batch/jobsQuery'
import { ITEM_STATUS_META, type BatchItemRow, type BatchJobDetail, type BatchTaskRow } from '../../types/batch'
import { JobActions } from '../jobs/JobActions'
import { ProgressBar } from '../jobs/badges'
import { ZipWriter } from '../../lib/review/zipStream'
import { showToast } from '../../hooks/useToast'
import { MediaImg } from '../ui/MediaImg'

const ACCENT = '#EC4899'

interface Props { jobId: string; compact?: boolean; onDeleted?: () => void }

function safeFile(s: string): string { return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video' }

export function VideoReviewPanel({ jobId, compact, onDeleted }: Props) {
  const jobsVersion = useBatchStore((s) => s.jobsVersion)
  const bump = useBatchStore((s) => s.bump)
  const [job, setJob] = useState<BatchJobDetail | null>(null)
  const [items, setItems] = useState<BatchItemRow[]>([])
  const [tasks, setTasks] = useState<BatchTaskRow[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [zipping, setZipping] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [j, its, ts] = await Promise.all([fetchJobDetail(jobId), fetchJobItems(jobId), fetchJobTasks(jobId)])
      setJob(j); setItems(its); setTasks(ts); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [jobId])
  useEffect(() => { setLoading(true); void loadAll().finally(() => setLoading(false)) }, [loadAll])
  useEffect(() => { void loadAll() }, [jobsVersion, loadAll])
  useEffect(() => subscribeJobItems(jobId, () => { void loadAll() }), [jobId, loadAll])

  const video = useMemo(() => videoNodeOf(job?.workflow_snapshot ?? null), [job])
  // 結果のパス（結合 = ノード id のタスク、ショット = <node>:shot:<i>）に署名
  const resultPaths = useMemo(() => tasks.filter((t) => t.status === 'completed' && t.result_path).map((t) => t.result_path as string), [tasks])
  const resultKey = resultPaths.join('|')
  useEffect(() => {
    const paths = resultKey ? resultKey.split('|') : []
    if (!paths.length) return
    let alive = true
    signBatchPaths(paths).then((m) => { if (alive) setSigned((s) => ({ ...s, ...m })) }).catch(() => {})
    return () => { alive = false }
  }, [resultKey])

  const tasksOf = (itemId: string) => tasks.filter((t) => t.item_id === itemId)
  const isVideoTask = (t: BatchTaskRow) => { const k = t.input?.__kind; return k === 'videoShot' || k === 'videoMerge' || !!parseShotTaskNodeId(t.node_id) || (!!video && t.node_id === video.id) }
  const isTerminal = (t: BatchTaskRow) => (t.input?.__inputs === undefined && video ? t.node_id === video.id : isTerminalVideoTask(t))
  const shotIndex = (t: BatchTaskRow) => ((t.input?.__shot as { index?: number } | undefined)?.index ?? parseShotTaskNodeId(t.node_id)?.index ?? 0)
  // 終端の動画（結合、無ければ生成）= この SKU の結果。ショット = 終端以外の動画タスク（スロット順）
  const mergeOf = (itemId: string) => tasksOf(itemId).filter(isVideoTask).find(isTerminal) ?? null
  const shotsOf = (itemId: string) => tasksOf(itemId).filter((t) => isVideoTask(t) && !isTerminal(t)).sort((a, b) => shotIndex(a) - shotIndex(b))

  // 書き出しの命名（設計 §4.4）: 写しに Export ノードがあればその規則（{sku}_{variant}_{index:02}・ZIP のフォルダ分け）、無ければ <SKU>.mp4
  const hasExport = !!job?.workflow_snapshot?.nodes?.some((n) => n?.data?.type === 'export')
  const exportParams = exportParamsFromSnapshot(job?.workflow_snapshot)
  const fileNameFor = (it: BatchItemRow, t: BatchTaskRow | null, inZip: boolean): string => {
    if (!hasExport) return `${safeFile(it.sku)}.mp4`
    const variant = typeof t?.input?.__label === 'string' && t.input.__label.trim() ? t.input.__label.trim() : 'video'
    const e = planExportEntries([{ variant, transparent: false, video: true }], { ...exportParams, zip: inZip }, itemInfoOfRow(it), new Date(), { skus: items.length }).entries[0]
    return `${e.folder}${e.base}.mp4`
  }
  const download = async (path: string, name: string) => {
    const url = signed[path] ?? (await signBatchPaths([path]))[path]
    if (!url) { showToast('ダウンロード用の URL を取得できません', 'error'); return }
    try {
      const blob = await (await fetch(url)).blob()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch { showToast('ダウンロードに失敗しました', 'error') }
  }
  const downloadAll = async () => {
    const targets = items.map((it) => ({ it, m: mergeOf(it.id) })).filter((x): x is { it: BatchItemRow; m: BatchTaskRow } => !!x.m && x.m.status === 'completed' && !!x.m.result_path)
    if (!targets.length) return
    setZipping(true)
    try {
      const map = await signBatchPaths(targets.map((t) => t.m.result_path as string))
      const zip = new ZipWriter()
      const root = `${safeFile(job?.name ?? 'videos')}/`   // 解凍後のフォルダ名 = ZIP 名（メモ 19）
      for (const t of targets) {
        const url = map[t.m.result_path as string]
        if (!url) continue
        const buf = await (await fetch(url)).arrayBuffer()
        zip.add(`${root}${fileNameFor(t.it, t.m, true)}`, new Uint8Array(buf))
      }
      const blob = zip.finish()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${safeFile(job?.name ?? 'videos')}.zip`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (e) { showToast(e instanceof Error ? e.message : 'ZIP の作成に失敗しました', 'error') }
    finally { setZipping(false) }
  }

  if (loading && !job) return <div className="flex items-center justify-center flex-1 gap-2 text-[12px] p-6" style={{ color: 'var(--text-tertiary)' }}><CircleNotch size={16} className="animate-spin" />結果を読み込み中…</div>
  if (error || !job) return <div className="p-5 text-[12px]" style={{ color: '#EF4444' }}>{error ? `読み込みに失敗しました: ${error}` : '結果が見つかりません'}</div>

  const p = jobProgress(job)
  const doneCount = items.filter((it) => mergeOf(it.id)?.status === 'completed').length
  const failedCount = items.filter((it) => it.status === 'failed').length

  return (
    <div className="flex flex-col h-full min-h-0">
      {isActiveJob(job) && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          <CircleNotch size={13} className="animate-spin shrink-0" style={{ color: ACCENT }} />
          <span className="tabular-nums shrink-0">{p.total ? `処理中 ${p.done + p.failed} / ${p.total}` : '写真を送っています…'}</span>
          <ProgressBar done={p.done} failed={p.failed} total={p.total} width={140} />
          <span style={{ color: 'var(--text-tertiary)' }}>動画の生成には 1 本あたり数分かかります</span>
          <div className="flex-1" />
          <JobActions job={job} only={['cancel']} onChanged={() => { bump(); void loadAll() }} />
        </div>
      )}
      {failedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0 text-[11px]" style={{ borderColor: 'var(--border)', background: 'rgba(239,68,68,0.06)', color: 'var(--text-secondary)' }}>
          <Warning size={13} weight="fill" className="shrink-0" style={{ color: '#EF4444' }} />
          <span className="font-medium" style={{ color: '#EF4444' }}>{failedCount} 件が失敗しました</span>
          <div className="flex-1" />
          <JobActions job={job} only={['retry']} onChanged={() => { bump(); void loadAll() }} onDeleted={onDeleted} />
        </div>
      )}
      <div className={`flex items-center gap-2 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} border-b shrink-0 text-[11px]`} style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
        <span className="tabular-nums">{doneCount} / {items.length} 件 完成</span>
        <div className="flex-1" />
        <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }} onClick={() => void downloadAll()} disabled={doneCount === 0 || zipping} title="完成した動画をまとめて ZIP でダウンロード">
          {zipping ? <CircleNotch size={14} className="animate-spin" /> : <DownloadSimple size={14} />}すべてダウンロード（{doneCount}）
        </button>
      </div>
      <div className={`flex-1 min-h-0 overflow-auto ${compact ? 'p-3' : 'p-4'}`}>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {items.map((it) => {
            const merge = mergeOf(it.id)
            const shots = shotsOf(it.id)
            const shotsDone = shots.filter((s) => s.status === 'completed').length
            const mergedUrl = merge?.result_path ? signed[merge.result_path] : null
            const st = ITEM_STATUS_META[it.status]
            return (
              <div key={it.id} className="flex flex-col gap-1.5">
                <div className="relative w-full" style={{ background: 'var(--bg-placeholder)', aspectRatio: it.width && it.height ? `${it.width} / ${it.height}` : '4 / 5', maxHeight: 520, border: '1px solid var(--border)' }}>
                  {mergedUrl ? (
                    <>
                      <MediaImg video src={mergedUrl} className="absolute inset-0 w-full h-full object-contain" muted loop autoPlay playsInline />
                      {merge && merge.status !== 'completed' && <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>{merge.status === 'submitted' ? '結合中…' : '結合待ち'}</span>}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px]" style={{ color: it.status === 'failed' ? '#EF4444' : 'var(--text-tertiary)' }}>
                      {it.status === 'processing' || it.status === 'pending' ? <CircleNotch size={16} className="animate-spin" /> : null}
                      <span>{it.status === 'failed' ? '失敗' : merge && merge.status === 'submitted' ? (merge.input?.__kind === 'videoShot' ? '生成中…' : '結合中…') : shots.length > 0 && shotsDone === shots.length && merge && merge.status !== 'completed' ? '結合待ち' : shotsDone > 0 ? `ショット ${shotsDone} / ${shots.length} 完了・終わると結合します` : st.label}</span>
                      {it.status === 'failed' && (merge?.error || shots.find((s) => s.error)?.error) ? <span className="px-3 text-center text-[10px]">{merge?.error ?? shots.find((s) => s.error)?.error}</span> : null}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0 px-0.5">
                  <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={it.sku}>{it.sort_order}. {it.sku}</span>
                  <div className="flex-1" />
                    {mergedUrl && merge?.result_path && <button className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} title="この動画をダウンロード（MP4）" onClick={() => void download(merge.result_path as string, fileNameFor(it, merge, false))}><DownloadSimple size={14} /></button>}
                </div>
              </div>
            )
          })}
        </div>
        {items.length === 0 && <div className="text-[12px] text-center py-8" style={{ color: 'var(--text-tertiary)' }}>SKU がありません</div>}
      </div>
    </div>
  )
}
