import { NavLink, Outlet, useNavigate } from 'react-router'
import {
  FolderOpen,
  Globe,
  Clock,
  Gear,
  Trash,
  Question,
  SignOut,
  CaretUpDown,
} from '@phosphor-icons/react'
import { useAuth } from '../../hooks/useAuth'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useEffect } from 'react'

const NAV_ITEMS = [
  { to: '/projects', icon: FolderOpen, label: 'My Projects' },
  { to: '/community', icon: Globe, label: 'Community' },
  { to: '/history', icon: Clock, label: 'History' },
]

function UserAvatar({ email }: { email: string }) {
  const initial = email[0].toUpperCase()
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-semibold shrink-0"
      style={{ background: '#7C3AED', color: '#fff' }}
    >
      {initial}
    </div>
  )
}

export function HomeLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { loadWorkflows, createNewWorkflow, workflows } = useWorkflowStore()

  useEffect(() => {
    loadWorkflows()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleNew() {
    await createNewWorkflow()
    const id = useWorkflowStore.getState().currentWorkflowId
    if (id) navigate(`/canvas/${id}`)
  }

  const recentWorkflows = workflows.slice(0, 6)

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: 'var(--bg-canvas)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col shrink-0 border-r"
        style={{
          width: 220,
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
        }}
      >
        {/* User / Workspace */}
        <div
          className="flex items-center gap-2.5 px-3 py-3 border-b cursor-default"
          style={{ borderColor: 'var(--border)' }}
        >
          {user && <UserAvatar email={user.email ?? 'U'} />}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              My Workspace
            </p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
              {user?.email ?? ''}
            </p>
          </div>
          <CaretUpDown size={14} style={{ color: 'var(--text-tertiary)' }} className="shrink-0" />
        </div>

        {/* Main nav */}
        <nav className="flex flex-col gap-0.5 px-2 pt-3">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                  isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} weight={isActive ? 'fill' : 'regular'} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Favorites */}
        <div className="px-3 pt-5 pb-1">
          <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Favorites
          </p>
        </div>
        <div className="px-3 py-1">
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>No favorites yet</p>
        </div>

        {/* Recent Projects */}
        {recentWorkflows.length > 0 && (
          <>
            <div className="px-3 pt-5 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Recent
              </p>
            </div>
            <div className="flex flex-col gap-0.5 px-2">
              {recentWorkflows.map((w) => (
                <button
                  key={w.id}
                  onClick={() => navigate(`/canvas/${w.id}`)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors duration-150 group"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
                  }}
                >
                  <FolderOpen size={13} className="shrink-0" />
                  <span className="text-[12px] truncate">{w.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom actions */}
        <div
          className="flex items-center justify-between px-3 py-3 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={handleNew}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
              title="新規ワークフロー"
            >
              <Trash size={14} />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
              title="設定"
            >
              <Gear size={14} />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
              title="ヘルプ"
            >
              <Question size={14} />
            </button>
          </div>
          <button
            onClick={signOut}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
            title="ログアウト"
          >
            <SignOut size={14} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
