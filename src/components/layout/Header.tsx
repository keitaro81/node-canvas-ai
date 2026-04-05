import { useRef, useState } from 'react'
import { Sparkles, Settings, LogOut, Check, Loader2, Clock, GitBranch, Layers } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useCanvasStore } from '../../stores/canvasStore'

function SaveStatus() {
  const { isSaving, hasUnsavedChanges, lastSavedAt } = useWorkflowStore()

  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-[#71717A]">
        <Loader2 size={11} className="animate-spin" />
        保存中...
      </span>
    )
  }

  if (hasUnsavedChanges) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-[#F59E0B]">
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
      <span className="flex items-center gap-1 text-[11px] text-[#22C55E]">
        <Check size={11} />
        {label}に保存
      </span>
    )
  }

  return null
}

export function Header() {
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
      className="flex items-center shrink-0 px-4 border-b border-[#27272A]"
      style={{ height: 48, background: '#111113' }}
    >
      {/* Left: Logo + Workflow name + save status */}
      <div className="flex items-center gap-2 min-w-0" style={{ width: '35%' }}>
        <Sparkles size={16} style={{ color: '#8B5CF6' }} className="shrink-0" />
        <span className="text-[14px] font-semibold text-[#FAFAFA] shrink-0">Node Canvas AI</span>
        <div className="w-px h-4 shrink-0" style={{ background: '#27272A' }} />
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="text-[12px] font-medium text-[#FAFAFA] bg-[#0A0A0B] border border-[#3F3F46] rounded px-2 py-0.5 outline-none focus:border-[#8B5CF6] min-w-0 w-[120px]"
            autoFocus
          />
        ) : (
          <button
            onClick={startEdit}
            className="text-[12px] text-[#A1A1AA] hover:text-[#FAFAFA] px-1 py-0.5 rounded hover:bg-[#1E1E22] transition-colors duration-150 truncate min-w-0"
          >
            {currentWorkflowName}
          </button>
        )}
        <SaveStatus />
      </div>

      {/* Center: Mode toggle */}
      <div className="flex-1 flex items-center justify-center">
        <div
          className="flex items-center"
          style={{
            background: '#0A0A0B',
            border: '1px solid #27272A',
            borderRadius: 8,
            padding: 3,
            gap: 2,
          }}
        >
          <button
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium transition-all"
            style={
              appMode === 'graph'
                ? { background: '#1E1E22', color: '#FAFAFA' }
                : { background: 'transparent', color: '#71717A' }
            }
            onClick={() => setAppMode('graph')}
          >
            <GitBranch size={12} />
            Canvas
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium transition-all"
            style={
              appMode === 'capsule'
                ? { background: '#1E1E22', color: '#FAFAFA' }
                : { background: 'transparent', color: '#71717A' }
            }
            onClick={() => setAppMode('capsule')}
          >
            <Layers size={12} />
            App
          </button>
        </div>
      </div>

      {/* Right: User + Settings */}
      <div className="flex items-center justify-end gap-1 shrink-0">
        {user && (
          <>
            <span
              className="text-[12px] text-[#71717A] truncate max-w-[120px]"
              title={user.email ?? ''}
            >
              {user.email}
            </span>
            <button
              onClick={signOut}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#1E1E22] transition-colors duration-150"
              title="ログアウト"
            >
              <LogOut size={14} style={{ color: '#A1A1AA' }} />
            </button>
          </>
        )}
        <button
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#1E1E22] transition-colors duration-150"
          title="Settings"
        >
          <Settings size={15} style={{ color: '#A1A1AA' }} />
        </button>
      </div>
    </header>
  )
}
