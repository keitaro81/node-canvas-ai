import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Plus, CircleNotch } from '@phosphor-icons/react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { getLatestGenerationUrlsByWorkflow } from '../../lib/api/generations'
import { WorkflowCard } from './WorkflowCard'
import type { WorkflowRow } from '../../lib/api/workflows'

export function ProjectsPage() {
  const navigate = useNavigate()
  const { workflows, loadWorkflows, createNewWorkflow, deleteWorkflow, renameWorkflow } = useWorkflowStore()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [thumbnailMap, setThumbnailMap] = useState<Record<string, string>>({})

  useEffect(() => {
    loadWorkflows()
      .then(() => {
        const wfs = useWorkflowStore.getState().workflows
        const noThumb = wfs.filter(
          (w) => !(w as { thumbnail_url?: string | null }).thumbnail_url
        )
        if (noThumb.length === 0) return
        return getLatestGenerationUrlsByWorkflow(noThumb.map((w) => w.id))
          .then(setThumbnailMap)
          .catch(() => {})
      })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function effectiveThumbnail(w: WorkflowRow): string | null {
    return (w as { thumbnail_url?: string | null }).thumbnail_url ?? thumbnailMap[w.id] ?? null
  }

  async function handleNew() {
    setCreating(true)
    try {
      await createNewWorkflow()
      const id = useWorkflowStore.getState().currentWorkflowId
      if (id) navigate(`/canvas/${id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div
        className="flex items-center justify-between px-8 py-5 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          My Projects
        </h1>
        <button
          onClick={handleNew}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-150 disabled:opacity-60"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-active)' }}
        >
          {creating
            ? <CircleNotch size={14} className="animate-spin" />
            : <Plus size={14} weight="bold" />
          }
          New project
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>No projects yet</p>
            <button
              onClick={handleNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium"
              style={{ background: 'var(--accent-primary)', color: '#fff' }}
            >
              <Plus size={14} weight="bold" />
              Create your first project
            </button>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {/* Create new project card */}
            <button
              onClick={handleNew}
              disabled={creating}
              className="flex flex-col text-left disabled:opacity-60"
            >
              {/* Thumbnail box */}
              <div
                className="relative w-full flex items-center justify-center rounded-xl overflow-hidden transition-all duration-150"
                style={{ aspectRatio: '16/10', background: '#ffffff', border: '1px solid var(--border)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
              >
                {creating
                  ? <CircleNotch size={28} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
                  : <Plus size={28} weight="light" style={{ color: 'var(--text-tertiary)' }} />
                }
              </div>
              {/* Info */}
              <div className="pt-2.5">
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  Create new project
                </p>
              </div>
            </button>

            {workflows.map((w) => (
              <WorkflowCard
                key={w.id}
                workflow={w}
                thumbnailOverride={effectiveThumbnail(w)}
                onDelete={deleteWorkflow}
                onRename={renameWorkflow}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
