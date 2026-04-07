import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { CircleNotch } from '@phosphor-icons/react'
import { getPublicWorkflows } from '../../lib/api/workflows'
import type { WorkflowRow } from '../../lib/api/workflows'
import { useWorkflowStore } from '../../stores/workflowStore'
import { WorkflowCard } from './WorkflowCard'

export function CommunityPage() {
  const navigate = useNavigate()
  const { cloneWorkflow } = useWorkflowStore()
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPublicWorkflows()
      .then(setWorkflows)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

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
            Community
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Public workflows shared by the community
          </p>
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
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>No public workflows yet</p>
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Open a project and toggle it to Public from the canvas header
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {workflows.map((w) => (
              <WorkflowCard key={w.id} workflow={w} onClone={handleClone} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
