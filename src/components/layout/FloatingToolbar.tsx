import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  FolderOpen,
  NotePencil,
  Gear,
  X,
  TextT,
  Sparkle,
  FilmStrip,
  Image,
  ImageSquare,
  Note,
  Wrench,
  MagicWand,
  TreeStructure,
  DotsThree,
  Pencil,
  Trash,
} from '@phosphor-icons/react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { rfInstanceRef } from '../../lib/rfInstanceRef'
import type { NodeType } from '../../types/nodes'
import type { WorkflowRow } from '../../lib/api/workflows'

// ─────────────────────────────────────────
// ノードパレット定義
// ─────────────────────────────────────────
const PALETTE = [
  {
    category: 'テキスト',
    items: [
      { type: 'textPrompt' as NodeType, label: 'Text Prompt', description: 'プロンプトを入力', icon: <TextT size={15} />, color: '#6366F1' },
      { type: 'promptEnhancer' as NodeType, label: 'Prompt Enhancer', description: 'AIがプロンプトを最適化', icon: <MagicWand size={15} />, color: '#6366F1' },
    ],
  },
  {
    category: '画像',
    items: [
      { type: 'imageGen' as NodeType, label: 'Image Generation', description: 'AI画像を生成', icon: <Sparkle size={15} />, color: '#8B5CF6' },
      { type: 'referenceImage' as NodeType, label: 'Reference Image', description: '参照画像をアップロード', icon: <Image size={15} />, color: '#8B5CF6' },
    ],
  },
  {
    category: '動画',
    items: [
      { type: 'videoGen' as NodeType, label: 'Video Generation', description: 'AI動画を生成', icon: <FilmStrip size={15} />, color: '#EC4899' },
    ],
  },
  {
    category: 'ユーティリティ',
    items: [
      { type: 'note' as NodeType, label: 'Note', description: 'メモ・注釈を追加', icon: <Note size={15} />, color: '#F59E0B' },
      { type: 'utility' as NodeType, label: 'Utility', description: 'ユーティリティノード', icon: <Wrench size={15} />, color: '#6B7280' },
    ],
  },
]

// ─────────────────────────────────────────
// ノード追加パネル
// ─────────────────────────────────────────
const NODE_TYPE_MAP: Record<NodeType, string> = {
  text: 'textNode', image: 'imageNode', video: 'videoNode', utility: 'utilityNode',
  textPrompt: 'textPromptNode', imageGen: 'imageGenerationNode', imageDisplay: 'imageDisplayNode',
  videoGen: 'videoGenerationNode', videoDisplay: 'videoDisplayNode', referenceImage: 'referenceImageNode',
  imageComposite: 'imageCompositeNode', note: 'noteNode', promptEnhancer: 'promptEnhancerNode', group: 'groupNode',
}

let nodeIdCounter = 1000

function buildNodeData(type: NodeType, label: string): Record<string, unknown> {
  if (type === 'videoGen') {
    return { label, model: 'ltx-2.3-fast', duration: '6', resolution: '1080p', aspectRatio: '16:9', fps: 25, audioEnabled: true, seed: null, status: 'idle', progress: '', videoUrl: null, fileName: null, error: null }
  }
  if (type === 'referenceImage') {
    return { label, imageUrl: null, uploadedImagePreview: null }
  }
  if (type === 'imageGen') {
    return { type: 'imageGen', label, params: { model: 'black-forest-labs/flux-schnell', aspectRatio: '1:1', seed: '' }, status: 'idle' }
  }
  if (type === 'promptEnhancer') {
    return { type: 'promptEnhancer', label, params: {}, status: 'idle', inputText: '', outputText: '', model: 'anthropic/claude-haiku-4.5' }
  }
  return { type, label, params: {}, status: 'idle' }
}

function NodePanel({ onClose }: { onClose: () => void }) {
  const addNode = useCanvasStore((s) => s.addNode)

  function handleDragStart(e: React.DragEvent, type: NodeType, label: string) {
    e.dataTransfer.setData('application/node-palette', JSON.stringify({ type, label }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleAdd(type: NodeType, label: string) {
    const rf = rfInstanceRef.current
    // キャンバス中央をフロー座標に変換
    const canvasEl = document.querySelector('.react-flow') as HTMLElement | null
    const bounds = canvasEl?.getBoundingClientRect()
    const screenCenter = bounds
      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const pos = rf
      ? rf.screenToFlowPosition(screenCenter)
      : screenCenter

    const id = `node-${Date.now()}-${nodeIdCounter++}`
    addNode({
      id,
      type: NODE_TYPE_MAP[type],
      position: { x: pos.x - 140, y: pos.y - 80 },
      data: buildNodeData(type, label) as never,
      ...(type === 'note' ? { style: { width: 280, height: 160 } } : {}),
    })
    setTimeout(() => {
      rfInstanceRef.current?.fitView({ nodes: [{ id }], duration: 400, padding: 0.5, maxZoom: 1.2 })
    }, 50)
    onClose()
  }

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 260,
        maxHeight: 'calc(100vh - 120px)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          ノードを追加
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {PALETTE.map((group) => (
          <div key={group.category} className="mb-4 last:mb-0">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {group.category}
            </div>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => (
                <div
                  key={item.type}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.type, item.label)}
                  onClick={() => handleAdd(item.type, item.label)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 select-none"
                  style={{ border: '1px solid transparent' }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'var(--bg-elevated)'
                    el.style.borderColor = 'var(--border)'
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.borderColor = 'transparent'
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${item.color}18`, color: item.color }}
                  >
                    {item.icon}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>
                      {item.label}
                    </span>
                    <span className="text-[11px] leading-tight mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {item.description}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// Workflowパネル
// ─────────────────────────────────────────
function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'たった今'
  if (mins < 60) return `${mins}分前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}時間前`
  return `${Math.floor(hours / 24)}日前`
}

function WorkflowPanel({ onClose }: { onClose: () => void }) {
  const {
    workflows, currentWorkflowId, hasUnsavedChanges,
    loadWorkflow, createNewWorkflow, renameWorkflow, deleteWorkflow: deleteWf,
    saveCurrentWorkflow,
  } = useWorkflowStore()

  const [menu, setMenu] = useState<{ workflowId: string; x: number; y: number } | null>(null)
  const [rename, setRename] = useState<{ workflowId: string; name: string } | null>(null)
  const [confirm, setConfirm] = useState<{ workflowId: string; name: string } | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (rename) setTimeout(() => renameInputRef.current?.select(), 0)
  }, [rename])

  useEffect(() => {
    if (!menu) return
    const handler = () => setMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [menu])

  async function handleSwitch(wf: WorkflowRow) {
    if (wf.id === currentWorkflowId) return
    if (hasUnsavedChanges) { setSwitching(wf.id); return }
    await loadWorkflow(wf.id)
  }

  async function handleSwitchConfirm(save: boolean) {
    if (!switching) return
    if (save) await saveCurrentWorkflow()
    await loadWorkflow(switching)
    setSwitching(null)
  }

  async function handleRenameCommit() {
    if (!rename) return
    const trimmed = rename.name.trim()
    if (trimmed) await renameWorkflow(rename.workflowId, trimmed)
    setRename(null)
  }

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 260,
        maxHeight: 'calc(100vh - 120px)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Workflows
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { createNewWorkflow(); onClose() }}
            className="w-6 h-6 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            title="新規ワークフロー"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <FolderOpen size={28} style={{ color: 'var(--border-active)' }} />
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              ワークフローがありません
            </span>
          </div>
        ) : (
          workflows.map((wf) => {
            const isActive = wf.id === currentWorkflowId
            return (
              <div
                key={wf.id}
                className="group/wf flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 mb-0.5"
                style={{
                  background: isActive ? 'var(--bg-elevated)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--border)' : 'transparent'}`,
                }}
                onClick={() => handleSwitch(wf)}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: isActive ? 'var(--accent-subtle)' : 'var(--bg-elevated)', color: isActive ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                  <TreeStructure size={12} />
                </div>
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
                      className="w-full text-[12px] rounded px-1.5 py-0.5 outline-none"
                      style={{ color: 'var(--text-primary)', background: 'var(--bg-canvas)', border: '1px solid var(--accent)' }}
                    />
                  ) : (
                    <>
                      <div className="text-[12px] font-medium truncate" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {wf.name}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {formatRelativeTime(wf.updated_at)}
                      </div>
                    </>
                  )}
                </div>
                <button
                  className="opacity-0 group-hover/wf:opacity-100 w-6 h-6 flex items-center justify-center rounded-lg transition-all duration-150 shrink-0"
                  style={{ color: 'var(--text-tertiary)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    setMenu({ workflowId: wf.id, x: rect.right, y: rect.bottom + 4 })
                  }}
                >
                  <DotsThree size={14} weight="bold" />
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Context menu (portal) */}
      {menu && createPortal(
        <div
          data-toolbar-portal
          className="fixed rounded-xl py-1 z-[99999]"
          style={{
            left: menu.x - 160,
            top: menu.y,
            width: 160,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
              }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            onClick={() => {
              const wf = workflows.find((w) => w.id === menu.workflowId)
              if (wf) setRename({ workflowId: wf.id, name: wf.name })
              setMenu(null)
            }}
          >
            <Pencil size={13} /> 名前を変更
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors"
            style={{ color: '#EF4444' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            onClick={() => {
              const wf = workflows.find((w) => w.id === menu.workflowId)
              if (wf) setConfirm({ workflowId: wf.id, name: wf.name })
              setMenu(null)
            }}
          >
            <Trash size={13} /> 削除
          </button>
        </div>,
        document.body
      )}

      {/* Delete confirm */}
      {confirm && createPortal(
        <div data-toolbar-portal className="fixed inset-0 flex items-center justify-center z-[99999]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setConfirm(null)}>
          <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ width: 320, background: 'var(--bg-surface)', border: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>ワークフローを削除</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>「{confirm.name}」を削除します。この操作は取り消せません。</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 rounded-lg text-[12px] transition-colors" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }} onClick={() => setConfirm(null)}>キャンセル</button>
              <button className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white transition-colors" style={{ background: '#EF4444' }} onClick={async () => { await deleteWf(confirm.workflowId); setConfirm(null) }}>削除</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Unsaved changes confirm */}
      {switching && createPortal(
        <div data-toolbar-portal className="fixed inset-0 flex items-center justify-center z-[99999]" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ width: 320, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>未保存の変更があります</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>ワークフローを切り替える前に保存しますか？</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 rounded-lg text-[12px] transition-colors" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }} onClick={() => setSwitching(null)}>キャンセル</button>
              <button className="px-3 py-1.5 rounded-lg text-[12px] transition-colors" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }} onClick={() => handleSwitchConfirm(false)}>保存せず切り替え</button>
              <button className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white" style={{ background: 'var(--accent)' }} onClick={() => handleSwitchConfirm(true)}>保存して切り替え</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ─────────────────────────────────────────
// メインツールバー
// ─────────────────────────────────────────
type Panel = 'nodes' | 'workflows' | null

export function FloatingToolbar() {
  const [activePanel, setActivePanel] = useState<Panel>(null)
  const addNode = useCanvasStore((s) => s.addNode)
  const containerRef = useRef<HTMLDivElement>(null)

  function toggle(panel: Panel) {
    setActivePanel((p) => (p === panel ? null : panel))
  }

  function handleAddNote() {
    addNode('note', 'Note')
  }

  // パネル外クリック / Escape で閉じる
  useEffect(() => {
    if (!activePanel) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActivePanel(null)
    }
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      // createPortal で body に出したダイアログ・メニューのクリックは無視
      if (target.closest('[data-toolbar-portal]')) return
      if (containerRef.current && !containerRef.current.contains(target)) {
        setActivePanel(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    // mousedown で拾う（クリック前に閉じることで競合を避ける）
    window.addEventListener('mousedown', handleClick)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('mousedown', handleClick)
    }
  }, [activePanel])

  const btnBase: React.CSSProperties = {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    cursor: 'pointer',
    transition: 'all 150ms ease-out',
    border: 'none',
    background: 'transparent',
  }

  function ToolBtn({
    panel,
    onClick,
    icon,
    title,
    active,
  }: {
    panel?: Panel
    onClick?: () => void
    icon: React.ReactNode
    title: string
    active?: boolean
  }) {
    const isActive = panel ? activePanel === panel : active
    return (
      <button
        style={{
          ...btnBase,
          background: isActive ? 'var(--accent)' : 'transparent',
          color: isActive ? '#fff' : 'var(--text-secondary)',
        }}
        onMouseEnter={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
        onClick={onClick ?? (() => panel && toggle(panel))}
        title={title}
      >
        {icon}
      </button>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 6px',
        borderRadius: 9999,
        background: 'var(--bg-toolbar)',
        border: '1px solid var(--border)',
      }}
    >
      {/* ノード追加 */}
      <ToolBtn
        panel="nodes"
        icon={<Plus size={18} weight="bold" />}
        title="ノードを追加"
      />

      {/* 区切り */}
      <div style={{ width: 24, height: 1, background: 'var(--border)', margin: '2px 0' }} />

      {/* Workflows */}
      <ToolBtn
        panel="workflows"
        icon={<FolderOpen size={18} />}
        title="Workflows"
      />

      {/* Note追加 */}
      <ToolBtn
        onClick={handleAddNote}
        icon={<NotePencil size={18} />}
        title="Noteを追加"
      />

      {/* 区切り */}
      <div style={{ width: 24, height: 1, background: 'var(--border)', margin: '2px 0' }} />

      {/* 設定 */}
      <ToolBtn
        onClick={() => {}}
        icon={<Gear size={18} />}
        title="設定"
      />

      {/* フローティングパネル */}
      {activePanel && (
        <div
          style={{
            position: 'absolute',
            left: 'calc(100% + 12px)',
            top: '50%',
            transform: 'translateY(-50%)',
          }}
        >
          {activePanel === 'nodes' && <NodePanel onClose={() => setActivePanel(null)} />}
          {activePanel === 'workflows' && <WorkflowPanel onClose={() => setActivePanel(null)} />}
        </div>
      )}
    </div>
  )
}
