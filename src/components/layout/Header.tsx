import { useRef, useState } from 'react'
import { Sparkles, Settings, LogOut, Check, Loader2, Clock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useWorkflowStore } from '../../stores/workflowStore'

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
      className="flex items-center justify-between shrink-0 px-4 border-b border-[#27272A]"
      style={{ height: 48, background: '#111113' }}
    >
      {/* Left: Logo */}
      <div className="flex items-center gap-2 w-[200px]">
        <Sparkles size={16} style={{ color: '#8B5CF6' }} />
        <span className="text-[14px] font-semibold text-[#FAFAFA]">Node Canvas AI</span>
      </div>

      {/* Center: Workflow name + save status */}
      <div className="flex flex-col items-center gap-0.5">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="text-[13px] font-medium text-[#FAFAFA] text-center bg-[#0A0A0B] border border-[#3F3F46] rounded px-2 py-0.5 outline-none focus:border-[#8B5CF6] w-[240px]"
            autoFocus
          />
        ) : (
          <button
            onClick={startEdit}
            className="text-[13px] font-medium text-[#FAFAFA] hover:text-white px-2 py-0.5 rounded hover:bg-[#1E1E22] transition-colors duration-150"
          >
            {currentWorkflowName}
          </button>
        )}
        <SaveStatus />
      </div>

      {/* Right: User + Settings */}
      <div className="flex items-center justify-end gap-1 w-[200px]">
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
