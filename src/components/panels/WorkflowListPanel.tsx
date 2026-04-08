import { useState, useRef, useEffect } from 'react'
import { Plus, MoreHorizontal, Pencil, Trash2, GitBranch } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useWorkflowStore } from '../../stores/workflowStore'
import type { WorkflowRow } from '../../lib/api/workflows'

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'たった今'
  if (mins < 60) return `${mins}分前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  return `${days}日前`
}

interface MenuState {
  workflowId: string
  x: number
  y: number
}

interface RenameState {
  workflowId: string
  name: string
}

interface ConfirmState {
  workflowId: string
  name: string
}

export function WorkflowListPanel() {
  const {
    workflows,
    currentWorkflowId,
    hasUnsavedChanges,
    loadWorkflow,
    createNewWorkflow,
    renameWorkflow,
    deleteWorkflow: deleteWf,
    saveCurrentWorkflow,
  } = useWorkflowStore()

  const navigate = useNavigate()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [rename, setRename] = useState<RenameState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (rename) setTimeout(() => renameInputRef.current?.select(), 0)
  }, [rename])

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!menu) return
    const handler = () => setMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [menu])

  async function handleSwitch(workflow: WorkflowRow) {
    if (workflow.id === currentWorkflowId) return

    if (hasUnsavedChanges) {
      setSwitching(workflow.id)
      return
    }
    navigate(`/canvas/${workflow.id}`)
  }

  async function handleSwitchConfirm(save: boolean) {
    if (!switching) return
    if (save) await saveCurrentWorkflow()
    navigate(`/canvas/${switching}`)
    setSwitching(null)
  }

  async function handleRenameCommit() {
    if (!rename) return
    const trimmed = rename.name.trim()
    if (trimmed) await renameWorkflow(rename.workflowId, trimmed)
    setRename(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
          Workflows
        </span>
        <button
          onClick={() => createNewWorkflow()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] transition-colors duration-150"
          title="新規ワークフロー"
        >
          <Plus size={14} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <GitBranch size={24} color="var(--border-active)" />
            <span className="text-[11px] text-[var(--text-tertiary)]">ワークフローがありません</span>
          </div>
        ) : (
          workflows.map((wf) => {
            const isActive = wf.id === currentWorkflowId
            return (
              <div
                key={wf.id}
                className="group/wf flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors duration-150 mb-0.5"
                style={{
                  background: isActive ? 'var(--bg-elevated)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--border-active)' : 'transparent'}`,
                }}
                onClick={() => handleSwitch(wf)}
              >
                <div className="flex-1 min-w-0">
                  {rename?.workflowId === wf.id ? (
                    <input
                      ref={renameInputRef}
                      value={rename.name}
                      onChange={(e) => setRename({ ...rename, name: e.target.value })}
                      onBlur={handleRenameCommit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameCommit()
                        if (e.key === 'Escape') setRename(null)
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-[12px] text-[var(--text-primary)] bg-[var(--bg-canvas)] border border-[#8B5CF6] rounded px-1.5 py-0.5 outline-none"
                    />
                  ) : (
                    <>
                      <div className="text-[12px] font-medium truncate" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {wf.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">
                        {formatRelativeTime(wf.updated_at)}
                      </div>
                    </>
                  )}
                </div>

                {/* More menu button */}
                <button
                  className="opacity-0 group-hover/wf:opacity-100 w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)] transition-all duration-150 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    setMenu({ workflowId: wf.id, x: rect.right, y: rect.bottom + 4 })
                  }}
                >
                  <MoreHorizontal size={13} color="var(--text-tertiary)" />
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* New workflow button */}
      <div className="px-2 pb-3">
        <button
          onClick={() => createNewWorkflow()}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors duration-150"
          style={{
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            background: 'transparent',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <Plus size={13} />
          新規ワークフロー
        </button>
      </div>

      {/* Context menu */}
      {menu && (
        <div
          className="fixed rounded-lg py-1 z-50"
          style={{
            left: menu.x - 160,
            top: menu.y,
            width: 160,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors duration-150"
            onClick={() => {
              const wf = workflows.find((w) => w.id === menu.workflowId)
              if (wf) setRename({ workflowId: wf.id, name: wf.name })
              setMenu(null)
            }}
          >
            <Pencil size={13} />
            名前を変更
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-[#EF4444] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
            onClick={() => {
              const wf = workflows.find((w) => w.id === menu.workflowId)
              if (wf) setConfirm({ workflowId: wf.id, name: wf.name })
              setMenu(null)
            }}
          >
            <Trash2 size={13} />
            削除
          </button>
        </div>
      )}

      {/* Delete confirm dialog */}
      {confirm && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setConfirm(null)}
        >
          <div
            className="rounded-xl p-5 flex flex-col gap-4"
            style={{ width: 320, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-[14px] font-semibold text-[var(--text-primary)]">ワークフローを削除</p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                「{confirm.name}」を削除します。この操作は取り消せません。
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
                style={{ border: '1px solid var(--border)' }}
                onClick={() => setConfirm(null)}
              >
                キャンセル
              </button>
              <button
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white transition-colors duration-150"
                style={{ background: '#EF4444' }}
                onClick={async () => {
                  await deleteWf(confirm.workflowId)
                  setConfirm(null)
                }}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes confirm dialog */}
      {switching && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}
        >
          <div
            className="rounded-xl p-5 flex flex-col gap-4"
            style={{ width: 320, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
          >
            <div>
              <p className="text-[14px] font-semibold text-[var(--text-primary)]">未保存の変更があります</p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                ワークフローを切り替える前に保存しますか？
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
                style={{ border: '1px solid var(--border)' }}
                onClick={() => setSwitching(null)}
              >
                キャンセル
              </button>
              <button
                className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
                style={{ border: '1px solid var(--border)' }}
                onClick={() => handleSwitchConfirm(false)}
              >
                保存せず切り替え
              </button>
              <button
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white transition-colors duration-150"
                style={{ background: '#8B5CF6' }}
                onClick={() => handleSwitchConfirm(true)}
              >
                保存して切り替え
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
