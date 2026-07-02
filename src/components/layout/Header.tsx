import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
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
  ArrowLeft,
  Globe,
  Lock,
  Copy,
  UsersThree,
  CaretDown,
} from '@phosphor-icons/react'
import { useAuth } from '../../hooks/useAuth'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useCanvasStore } from '../../stores/canvasStore'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { WorkflowVisibility } from '../../lib/api/workflows'

type IconCmp = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold'; style?: React.CSSProperties }>

// 可視性セレクタの表示メタ（private=自分のみ / team=同チーム共有 / public=コミュニティ）
const VISIBILITY_META: Record<WorkflowVisibility, { label: string; desc: string; Icon: IconCmp; color: string; bg: string; border: string }> = {
  private: { label: 'Private', desc: '自分のみ', Icon: Lock, color: 'var(--text-secondary)', bg: 'var(--bg-elevated)', border: 'var(--border)' },
  team: { label: 'Team', desc: '同じチームに共有', Icon: UsersThree, color: '#6366F1', bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.25)' },
  public: { label: 'Public', desc: 'Communityに公開', Icon: Globe, color: '#22C55E', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.25)' },
}

function SaveStatus() {
  const { isSaving, hasUnsavedChanges, lastSavedAt } = useWorkflowStore()
  const isMobile = useIsMobile()

  // 「◯分前に保存」の表示を1分ごとに更新する（レンダー中に Date.now() を呼ばないため state で保持）
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-[11px] whitespace-nowrap shrink-0" style={{ color: 'var(--text-tertiary)' }}>
        <CircleNotch size={11} className="animate-spin" />
        {!isMobile && '保存中...'}
      </span>
    )
  }

  if (hasUnsavedChanges) {
    return (
      <span className="flex items-center gap-1 text-[11px] whitespace-nowrap shrink-0" style={{ color: 'var(--warning)' }}>
        <Clock size={11} />
        {!isMobile && '未保存の変更あり'}
      </span>
    )
  }

  if (lastSavedAt) {
    const diff = now - lastSavedAt.getTime()
    const mins = Math.floor(diff / 60000)
    const label = mins < 1 ? 'たった今' : `${mins}分前`
    return (
      <span className="flex items-center gap-1 text-[11px] whitespace-nowrap shrink-0" style={{ color: 'var(--success)' }}>
        <Check size={11} weight="bold" />
        {!isMobile && `${label}に保存`}
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
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { user, signOut } = useAuth()
  const {
    currentWorkflowName,
    currentWorkflowId,
    currentWorkflowVisibility,
    currentWorkflowIsOwned,
    renameWorkflow,
    setCurrentWorkflowName,
    setVisibility,
    cloneWorkflow,
  } = useWorkflowStore()
  const appMode = useCanvasStore((s) => s.appMode)
  const setAppMode = useCanvasStore((s) => s.setAppMode)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(currentWorkflowName)
  const [togglingPublic, setTogglingPublic] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [visMenuOpen, setVisMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const visMenuRef = useRef<HTMLDivElement>(null)

  // 可視性メニューの外側クリックで閉じる
  useEffect(() => {
    if (!visMenuOpen) return
    function onDown(e: MouseEvent) {
      if (visMenuRef.current && !visMenuRef.current.contains(e.target as Node)) setVisMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [visMenuOpen])

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

  async function handleSetVisibility(v: WorkflowVisibility) {
    setVisMenuOpen(false)
    if (v === currentWorkflowVisibility) return
    setTogglingPublic(true)
    try {
      await setVisibility(v)
    } finally {
      setTogglingPublic(false)
    }
  }

  async function handleClone() {
    setCloning(true)
    try {
      const newId = await cloneWorkflow()
      navigate(`/canvas/${newId}`)
    } finally {
      setCloning(false)
    }
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
      {/* Left: Back + Workflow name + save status */}
      <div className="flex items-center gap-2 min-w-0" style={{ width: isMobile ? '70%' : '45%' }}>
        {/* Back to home */}
        <button
          onClick={() => navigate('/projects')}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150 shrink-0"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
          title="ホームへ戻る"
        >
          <ArrowLeft size={15} />
        </button>

        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />

        {!currentWorkflowIsOwned ? (
          <span className="text-[12px] px-1 py-0.5 truncate min-w-0" style={{ color: 'var(--text-secondary)' }}>
            {currentWorkflowName}
          </span>
        ) : editing ? (
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
        {currentWorkflowIsOwned && <SaveStatus />}
      </div>

      {/* Center: Mode toggle — デスクトップのみ */}
      <div className="flex-1 flex items-center justify-center">
        {!isMobile && (
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
        )}
      </div>

      {/* Right: Public toggle / Read only + Clone + Theme + User + Settings */}
      <div className="flex items-center justify-end gap-1 shrink-0" style={{ width: '35%' }}>
        {currentWorkflowIsOwned ? (
          /* Public/Private toggle — 自分のワークフロー（モバイルでは非表示） */
          !isMobile && (
          <div className="relative" ref={visMenuRef}>
            <button
              onClick={() => setVisMenuOpen((o) => !o)}
              disabled={togglingPublic}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-150 disabled:opacity-50"
              style={{
                background: VISIBILITY_META[currentWorkflowVisibility].bg,
                color: VISIBILITY_META[currentWorkflowVisibility].color,
                border: `1px solid ${VISIBILITY_META[currentWorkflowVisibility].border}`,
              }}
              title="表示範囲を変更"
            >
              {togglingPublic ? (
                <CircleNotch size={11} className="animate-spin" />
              ) : (
                (() => {
                  const Cur = VISIBILITY_META[currentWorkflowVisibility].Icon
                  return <Cur size={11} weight={currentWorkflowVisibility === 'private' ? 'regular' : 'fill'} />
                })()
              )}
              {VISIBILITY_META[currentWorkflowVisibility].label}
              <CaretDown size={9} weight="bold" style={{ opacity: 0.6 }} />
            </button>
            {visMenuOpen && (
              <div
                className="absolute right-0 z-50 rounded-lg overflow-hidden"
                style={{
                  top: 'calc(100% + 4px)',
                  minWidth: 184,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                }}
              >
                {(['private', 'team', 'public'] as WorkflowVisibility[]).map((v) => {
                  const meta = VISIBILITY_META[v]
                  const ItemIcon = meta.Icon
                  const active = v === currentWorkflowVisibility
                  return (
                    <button
                      key={v}
                      onClick={() => handleSetVisibility(v)}
                      className="flex items-start gap-2 w-full px-3 py-2 text-left transition-colors duration-150"
                      style={{ background: active ? 'var(--bg-elevated)' : 'transparent' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = active ? 'var(--bg-elevated)' : 'transparent' }}
                    >
                      <ItemIcon size={13} weight={v === 'private' ? 'regular' : 'fill'} style={{ color: meta.color, marginTop: 1, flexShrink: 0 }} />
                      <span className="flex flex-col min-w-0">
                        <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                          {meta.label}
                          {active && <Check size={11} weight="bold" style={{ color: meta.color }} />}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{meta.desc}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          )
        ) : (
          /* Read only + Clone — 他人のワークフロー */
          <>
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium shrink-0"
              style={{ background: 'rgba(245,158,11,0.1)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.2)' }}
            >
              <Lock size={11} />
              Read only
            </span>
            <button
              onClick={handleClone}
              disabled={cloning}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-150 disabled:opacity-50 shrink-0"
              style={{ background: 'var(--accent)', color: '#fff' }}
              title="自分のプロジェクトにコピーして編集可能にする"
            >
              {cloning
                ? <CircleNotch size={11} className="animate-spin" />
                : <Copy size={11} weight="bold" />
              }
              Clone
            </button>
          </>
        )}

        {/* Theme toggle — デスクトップのみ */}
        {!isMobile && (
          <button
            onClick={onToggleTheme}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            title={theme === 'light' ? 'ダークモードへ' : 'ライトモードへ'}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
        )}

        {user && (
          <>
            {!isMobile && currentWorkflowIsOwned && (
              <span
                className="text-[12px] truncate max-w-[120px]"
                style={{ color: 'var(--text-tertiary)' }}
                title={user.email ?? ''}
              >
                {user.email}
              </span>
            )}
            {!isMobile && (
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
            )}
          </>
        )}
        {!isMobile && (
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            title="設定"
          >
            <Gear size={15} />
          </button>
        )}
      </div>
    </header>
  )
}
