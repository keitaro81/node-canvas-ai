import { useRef, useState } from 'react'
import {
  Gear,
  SignOut,
  Check,
  CircleNotch,
  Clock,
  TreeStructure,
  Stack,
  Sun,
  Moon,
} from '@phosphor-icons/react'
import { useAuth } from '../../hooks/useAuth'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useCanvasStore } from '../../stores/canvasStore'

function SaveStatus() {
  const { isSaving, hasUnsavedChanges, lastSavedAt } = useWorkflowStore()

  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        <CircleNotch size={11} className="animate-spin" />
        保存中...
      </span>
    )
  }

  if (hasUnsavedChanges) {
    return (
      <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--warning)' }}>
        <Clock size={11} />
        未保存の変更あり
      </span>
    )
  }

  if (lastSavedAt) {
    const diff = Date.now() - lastSavedAt.getTime()
    const mins = Math.floor(diff / 60000)
    const label = mins < 1 ? 'たった今' : `${mins}分前`
    return (
      <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--success)' }}>
        <Check size={11} weight="bold" />
        {label}に保存
      </span>
    )
  }

  return null
}

interface HeaderProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  const { user, signOut } = useAuth()
  const { currentWorkflowName, currentWorkflowId, renameWorkflow, setCurrentWorkflowName } = useWorkflowStore()
  const appMode = useCanvasStore((s) => s.appMode)
  const setAppMode = useCanvasStore((s) => s.setAppMode)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(currentWorkflowName)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setDraft(currentWorkflowName)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function commitEdit() {
    const trimmed = draft.trim()
    const name = trimmed || 'Untitled Workflow'
    setCurrentWorkflowName(name)
    setEditing(false)
    if (currentWorkflowId) {
      await renameWorkflow(currentWorkflowId, name)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <header
      className="flex items-center shrink-0 px-4 border-b"
      style={{
        height: 48,
        background: 'var(--bg-header)',
        borderColor: 'var(--border-header)',
      }}
    >
      {/* Left: Logo + Workflow name + save status */}
      <div className="flex items-center gap-2 min-w-0" style={{ width: '35%' }}>
        <span
          className="text-[14px] font-semibold shrink-0"
          style={{ color: 'var(--text-primary)' }}
        >
          Node Canvas AI
        </span>
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="text-[12px] font-medium rounded px-2 py-0.5 outline-none min-w-0 w-[120px]"
            style={{
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-active)',
            }}
            autoFocus
          />
        ) : (
          <button
            onClick={startEdit}
            className="text-[12px] px-1 py-0.5 rounded transition-colors duration-150 truncate min-w-0"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {currentWorkflowName}
          </button>
        )}
        <SaveStatus />
      </div>

      {/* Center: Mode toggle — ピル型 */}
      <div className="flex-1 flex items-center justify-center">
        <div
          className="flex items-center p-0.5 rounded-full"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
          }}
        >
          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all duration-150"
            style={
              appMode === 'graph'
                ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                : { background: 'transparent', color: 'var(--text-tertiary)' }
            }
            onClick={() => setAppMode('graph')}
          >
            <TreeStructure size={13} weight={appMode === 'graph' ? 'bold' : 'regular'} />
            Canvas
          </button>
          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all duration-150"
            style={
              appMode === 'capsule'
                ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                : { background: 'transparent', color: 'var(--text-tertiary)' }
            }
            onClick={() => setAppMode('capsule')}
          >
            <Stack size={13} weight={appMode === 'capsule' ? 'bold' : 'regular'} />
            App
          </button>
        </div>
      </div>

      {/* Right: Theme toggle + User + Settings */}
      <div className="flex items-center justify-end gap-1 shrink-0" style={{ width: '35%' }}>
        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          title={theme === 'light' ? 'ダークモードへ' : 'ライトモードへ'}
        >
          {theme === 'light'
            ? <Moon size={15} />
            : <Sun size={15} />
          }
        </button>

        {user && (
          <>
            <span
              className="text-[12px] truncate max-w-[120px]"
              style={{ color: 'var(--text-tertiary)' }}
              title={user.email ?? ''}
            >
              {user.email}
            </span>
            <button
              onClick={signOut}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              title="ログアウト"
            >
              <SignOut size={15} />
            </button>
          </>
        )}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          title="設定"
        >
          <Gear size={15} />
        </button>
      </div>
    </header>
  )
}
