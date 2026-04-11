import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { DotsThree, Globe, Lock, Play, PencilSimple, Trash, Copy } from '@phosphor-icons/react'
import type { WorkflowRow } from '../../lib/api/workflows'

interface WorkflowCardProps {
  workflow: WorkflowRow
  thumbnailOverride?: string | null
  onDelete?: (id: string) => void
  onRename?: (id: string, name: string) => Promise<void>
  onClone?: (id: string) => void
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  'linear-gradient(135deg, #1a0a2e 0%, #2d1b69 50%, #11998e 100%)',
  'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #6d28d9 100%)',
  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  'linear-gradient(135deg, #1a1a2e 0%, #6d28d9 50%, #ec4899 100%)',
]

function getGradient(id: string): string {
  return PLACEHOLDER_GRADIENTS[id.charCodeAt(0) % PLACEHOLDER_GRADIENTS.length]
}

export function WorkflowCard({ workflow, thumbnailOverride, onDelete, onRename, onClone }: WorkflowCardProps) {
  const navigate = useNavigate()
  const isPublic = (workflow as { is_public?: boolean }).is_public ?? false
  const thumbnailUrl = thumbnailOverride ?? (workflow as { thumbnail_url?: string | null }).thumbnail_url
  const isVideo = thumbnailUrl ? isVideoUrl(thumbnailUrl) : false

  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft] = useState(workflow.name)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  // リネームモード開始時にinputにフォーカス
  useEffect(() => {
    if (isRenaming) {
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [isRenaming])

  function handleCardClick() {
    if (isRenaming) return
    navigate(`/canvas/${workflow.id}`)
  }

  function handleMenuClick(e: React.MouseEvent) {
    e.stopPropagation()
    setMenuOpen((v) => !v)
  }

  function startRename(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(workflow.name)
    setIsRenaming(true)
    setMenuOpen(false)
  }

  async function commitRename() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== workflow.name && onRename) {
      await onRename(workflow.id, trimmed)
    }
    setIsRenaming(false)
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setIsRenaming(false)
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setMenuOpen(false)
    setShowDeleteConfirm(true)
  }

  function confirmDelete() {
    setShowDeleteConfirm(false)
    onDelete?.(workflow.id)
  }

  return (
    <>
    <div
      onClick={handleCardClick}
      className="group flex flex-col cursor-pointer"
    >
      {/* Thumbnail box */}
      <div
        className="relative w-full overflow-hidden rounded-xl transition-all duration-150"
        style={{ aspectRatio: '16/10', background: getGradient(workflow.id), border: '1px solid var(--border)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
      >
        {thumbnailUrl && !isVideo && (
          <img src={thumbnailUrl} alt={workflow.name} className="w-full h-full object-cover" />
        )}
        {thumbnailUrl && isVideo && (
          <>
            <video src={thumbnailUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full flex items-center justify-center opacity-80"
                style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                <Play size={14} weight="fill" color="#fff" />
              </div>
            </div>
          </>
        )}
        {!thumbnailUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-lg opacity-30" style={{ background: 'var(--accent)' }} />
          </div>
        )}

        {/* Visibility badge */}
        <div
          className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{
            background: isPublic ? 'rgba(34,197,94,0.15)' : 'rgba(0,0,0,0.4)',
            color: isPublic ? '#22C55E' : 'rgba(255,255,255,0.5)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {isPublic ? <Globe size={10} weight="fill" /> : <Lock size={10} />}
          {isPublic ? 'Public' : 'Private'}
        </div>
      </div>

      {/* Info — outside the box */}
      <div className="flex items-start justify-between pt-2.5 gap-2">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleRenameKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-[13px] font-medium rounded px-1.5 py-0.5 outline-none"
              style={{
                color: 'var(--text-primary)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-active)',
              }}
            />
          ) : (
            <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {workflow.name}
            </p>
          )}
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Edited {formatDate(workflow.updated_at)}
          </p>
        </div>

        {/* Menu button + dropdown */}
        <div className="relative shrink-0 mt-0.5" ref={menuRef}>
          <button
            onClick={handleMenuClick}
            className="w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{ color: 'var(--text-secondary)', background: menuOpen ? 'var(--bg-elevated)' : 'transparent' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { if (!menuOpen) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <DotsThree size={16} weight="bold" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-8 z-50 flex flex-col rounded-lg overflow-hidden py-1 min-w-[120px]"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {onClone && (
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onClone(workflow.id) }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors duration-100"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <Copy size={13} />
                  クローン
                </button>
              )}
              {onRename && (
                <button
                  onClick={startRename}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors duration-100"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <PencilSimple size={13} />
                  名前を変更
                </button>
              )}
              {onDelete && (
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors duration-100"
                  style={{ color: '#EF4444' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <Trash size={13} />
                  削除
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* 削除確認モーダル */}
    {showDeleteConfirm && createPortal(
      <div
        className="fixed inset-0 flex items-center justify-center z-[9999]"
        style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
        onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false) }}
      >
        <div
          className="rounded-2xl p-5 flex flex-col gap-4"
          style={{ width: 320, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>ワークフローを削除</p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              「{workflow.name}」を削除します。この操作は取り消せません。
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="px-3 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              onClick={() => setShowDeleteConfirm(false)}
            >
              キャンセル
            </button>
            <button
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white transition-colors"
              style={{ background: '#EF4444' }}
              onClick={confirmDelete}
            >
              削除
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}
