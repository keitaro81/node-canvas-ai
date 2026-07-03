import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { CircleNotch, Gear } from '@phosphor-icons/react'
import { getTeamWorkflows } from '../../lib/api/workflows'
import type { WorkflowRow } from '../../lib/api/workflows'
import { getTeamWorkflowCreators, type WorkflowCreator } from '../../lib/api/team'
import { useWorkflowStore } from '../../stores/workflowStore'
import { WorkflowCard } from './WorkflowCard'

export function TeamPage() {
  const navigate = useNavigate()
  const { cloneWorkflow } = useWorkflowStore()
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([])
  const [creators, setCreators] = useState<Record<string, WorkflowCreator>>({})
  const [filter, setFilter] = useState<string>('all') // 'all' | userId
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 作成者はサーバー解決（projects は RLS で本人のみのため）。失敗してもカード表示は継続。
    Promise.all([getTeamWorkflows(), getTeamWorkflowCreators().catch(() => ({}))])
      .then(([wfs, cr]) => {
        setWorkflows(wfs)
        setCreators(cr)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  // フィルタ候補 = 表示中 WF の作成者（重複除去）
  const creatorOptions: Array<{ userId: string; email: string }> = []
  for (const w of workflows) {
    const c = creators[w.id]
    if (c?.userId && c.email && !creatorOptions.some((o) => o.userId === c.userId)) {
      creatorOptions.push({ userId: c.userId, email: c.email })
    }
  }
  const visibleWorkflows = filter === 'all'
    ? workflows
    : workflows.filter((w) => creators[w.id]?.userId === filter)

  async function handleClone(workflowId: string) {
    const newId = await cloneWorkflow(workflowId)
    navigate(`/canvas/${newId}`)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div
        className="flex items-center justify-between px-8 py-5 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Team
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Workflows shared with your team
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {creatorOptions.length > 1 && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-[12px] rounded-lg px-2 py-1.5 outline-none"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              title="作成者で絞り込み"
            >
              <option value="all">作成者: 全員</option>
              {creatorOptions.map((o) => (
                <option key={o.userId} value={o.userId}>{o.email}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => navigate('/team/settings')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium shrink-0 transition-colors"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <Gear size={13} />
            メンバー管理
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-[13px]" style={{ color: 'var(--accent-error)' }}>{error}</p>
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>No team workflows yet</p>
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Open a project and set it to Team from the canvas header
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {visibleWorkflows.map((w) => (
              <WorkflowCard key={w.id} workflow={w} creatorLabel={creators[w.id]?.email ?? null} onClone={handleClone} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
