// Apps ページ（フェーズ C(c)）: App 化されたワークフロー（Batch Input がある撮影後工程 / App 化したグループの生成）を、
// 自分のものとチームに共有されたものから集めて一覧にする。カードをクリックすると App モードで開く（ボタンは置かない。キャンバスは My Projects から）。
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppWindow, CircleNotch, Images, Sparkle } from '@phosphor-icons/react'
import { getTeamWorkflows, type WorkflowRow } from '../../lib/api/workflows'
import { useWorkflowStore } from '../../stores/workflowStore'
import { appKindOf, APP_KIND_LABEL, type AppKind } from '../../lib/apps/appKind'
import { formatJst, formatRelativeJa } from '../../lib/batch/dates'
import { AppsSectionTabs } from './AppsSectionTabs'

interface AppEntry { workflow: WorkflowRow; kind: AppKind; mine: boolean }
type KindFilter = 'all' | AppKind

export function AppsPage() {
  const navigate = useNavigate()
  const { workflows: mine, loadWorkflows } = useWorkflowStore()
  const [team, setTeam] = useState<WorkflowRow[]>([])
  const [filter, setFilter] = useState<KindFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id) }, [])

  useEffect(() => {
    let alive = true
    Promise.all([loadWorkflows(), getTeamWorkflows()])
      .then(([, t]) => { if (!alive) return; setTeam(t); setError(null) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadWorkflows])

  const apps = useMemo<AppEntry[]>(() => {
    const mineIds = new Set(mine.map((w) => w.id))
    const all = [...mine.map((w) => ({ w, mine: true })), ...team.filter((w) => !mineIds.has(w.id)).map((w) => ({ w, mine: false }))]
    return all
      .map(({ w, mine: m }) => ({ workflow: w, kind: appKindOf(w.canvas_data), mine: m }))
      .filter((e): e is AppEntry => !!e.kind)
      .sort((a, b) => (a.workflow.updated_at < b.workflow.updated_at ? 1 : -1))
  }, [mine, team])


  const visible = filter === 'all' ? apps : apps.filter((a) => a.kind === filter)
  const kindCounts = { batch: apps.filter((a) => a.kind === 'batch').length, generation: apps.filter((a) => a.kind === 'generation').length }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-8 py-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>Apps</h1>
          <AppsSectionTabs active="apps" />
        </div>
        <div className="flex items-center rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--border)' }}>
          {([['all', `すべて ${apps.length}`], ['batch', `撮影後工程 ${kindCounts.batch}`], ['generation', `生成 ${kindCounts.generation}`]] as Array<[KindFilter, string]>).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className="h-8 px-3 text-[12px] font-medium transition-colors" style={{ background: filter === k ? 'var(--bg-elevated)' : 'transparent', color: filter === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-48"><CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} /></div>
        ) : error ? (
          <div className="flex items-center justify-center h-48"><p className="text-[13px]" style={{ color: 'var(--accent-error)' }}>{error}</p></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 gap-2 text-center">
            <AppWindow size={32} style={{ color: 'var(--border-active)' }} />
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>App はまだありません</p>
            <p className="text-[12px] max-w-[520px]" style={{ color: 'var(--text-tertiary)' }}>
              Batch Input を置いた撮影後工程のワークフロー、またはグループを App 化した生成ワークフローがここに並びます。
              チームに共有すると、他のメンバーの Apps にも出ます。
            </p>
            <button onClick={() => navigate('/projects')} className="mt-2 px-3 h-8 rounded-lg text-[12px]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>My Projects へ</button>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {visible.map((a) => (
              <AppCard
                key={a.workflow.id} entry={a}
                now={now}
                onOpenApp={() => navigate(`/app/${a.workflow.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AppCard({ entry, now, onOpenApp }: { entry: AppEntry; now: number; onOpenApp: () => void }) {
  const { workflow: w, kind } = entry
  const accent = kind === 'batch' ? '#14B8A6' : '#8B5CF6'
  const Icon = kind === 'batch' ? Images : Sparkle
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpenApp}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenApp() } }}
      className="rounded-xl overflow-hidden flex flex-col cursor-pointer transition-colors outline-none focus-visible:ring-2"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      title={`${w.name} を開く`}
    >
      {/* カード全体が App を開くリンク（「App で開く」「キャンバス」のボタンは置かない。キャンバスは My Projects から） */}
      <div className="relative w-full" style={{ aspectRatio: '16 / 9', background: 'var(--bg-canvas)' }}>
        {w.thumbnail_url
          ? <img src={w.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
          : <div className="absolute inset-0 flex items-center justify-center"><Icon size={32} style={{ color: 'var(--border-active)' }} /></div>}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-medium" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
          <Icon size={12} style={{ color: accent }} />{APP_KIND_LABEL[kind]}
        </span>
      </div>
      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={w.name}>{w.name}</div>
        <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }} title={formatJst(w.updated_at)}>{formatRelativeJa(w.updated_at, now)}</div>
      </div>
    </div>
  )
}
