import { useParams } from 'react-router'
import { useWatchBatchJobs } from '../../stores/batchStore'
import { useReviewStore } from '../../lib/review/reviewStore'
import { JobReviewPanel } from './review/JobReviewPanel'

/** ジョブ詳細（確認グリッド）。中身は JobReviewPanel（一括結果ノードと共通） */
export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  useWatchBatchJobs('job-detail')   // 開いている間だけ Realtime を購読
  if (!jobId) return null
  return <JobReviewPanel key={jobId} jobId={jobId} store={useReviewStore} mode="page" />
}
