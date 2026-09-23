import { useNavigate } from 'react-router'
import { CircleNotch } from '@phosphor-icons/react'
import { useBatchStore } from '../../stores/batchStore'

/** 進行中ジョブの常時表示（仕様 4-8）。クリックでジョブ管理画面へ */
export function ActiveJobsIndicator() {
  const navigate = useNavigate()
  const activeJobs = useBatchStore((s) => s.activeJobs)
  if (!activeJobs.length) return null
  const done = activeJobs.reduce((s, j) => s + (j.completed_tasks ?? 0) + (j.failed_tasks ?? 0), 0)
  const total = activeJobs.reduce((s, j) => s + (j.task_count ?? 0), 0)
  return (
    <button
      onClick={() => navigate('/jobs')}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap shrink-0 transition-opacity hover:opacity-80"
      style={{ background: 'rgba(99,102,241,0.12)', color: '#6366F1', border: '1px solid rgba(99,102,241,0.25)' }}
      title="ジョブ管理へ"
    >
      <CircleNotch size={11} className="animate-spin" />
      処理中 {activeJobs.length} 件{total ? ` · ${done} / ${total}` : ''}
    </button>
  )
}
