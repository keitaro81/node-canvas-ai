import { useEffect, useRef } from 'react'
import { Type, Wrench, Sparkles, StickyNote, Film, ImagePlus, Wand2, Ungroup, Video } from 'lucide-react'
import type { NodeType, PortType } from '../../types/nodes'

interface MenuItem {
  type: NodeType
  label: string
  icon: React.ReactNode
  color: string
}

// ノードタイプが受け付けるポートタイプ（空配列 = 入力なし）
const NODE_ACCEPTS: Partial<Record<NodeType, string[]>> = {
  textPrompt:     [],
  referenceImage: [],
  referenceVideo: [],
  promptEnhancer: [],
  imageGen:       ['text', 'image'],
  videoGen:       ['text', 'image'],
  note:           [],
  utility:        ['text'],
}

// ノードタイプが出力するポートタイプ（空配列 = 出力なし）
const NODE_OUTPUTS: Partial<Record<NodeType, string[]>> = {
  textPrompt:     ['text'],
  promptEnhancer: ['text'],
  imageGen:       ['image'],
  referenceImage: ['image'],
  videoGen:       ['video'],
  referenceVideo: ['video'],
  note:           [],
  utility:        ['text'],
}

const MENU_ITEMS: Array<{ category: string; items: MenuItem[] }> = [
  {
    category: 'Text',
    items: [
      { type: 'textPrompt',     label: 'Text Prompt',      icon: <Type size={14} />,     color: '#6366F1' },
      { type: 'promptEnhancer', label: 'Prompt Enhancer',  icon: <Wand2 size={14} />,    color: '#6366F1' },
    ],
  },
  {
    category: 'Image',
    items: [
      { type: 'imageGen',       label: 'Image Generation', icon: <Sparkles size={14} />,  color: '#8B5CF6' },
      { type: 'referenceImage', label: 'Reference Image',  icon: <ImagePlus size={14} />, color: '#8B5CF6' },
    ],
  },
  {
    category: 'Video',
    items: [
      { type: 'videoGen',       label: 'Video Generation', icon: <Film size={14} />,  color: '#EC4899' },
      { type: 'referenceVideo', label: 'Reference Video',  icon: <Video size={14} />, color: '#EC4899' },
    ],
  },
  {
    category: 'Utility',
    items: [
      { type: 'note',    label: 'Note',    icon: <StickyNote size={14} />, color: '#F59E0B' },
      { type: 'utility', label: 'Utility', icon: <Wrench size={14} />,    color: '#6B7280' },
    ],
  },
]


interface ContextMenuProps {
  x: number
  y: number
  onSelect: (type: NodeType, label: string) => void
  onClose: () => void
  sourcePortType?: PortType
  sourceIsInput?: boolean
  groupNodeId?: string
  onUngroup?: (groupId: string) => void
}

export function ContextMenu({ x, y, onSelect, onClose, sourcePortType, sourceIsInput, groupNodeId, onUngroup }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const filteredGroups = sourcePortType
    ? MENU_ITEMS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (sourceIsInput) {
            // 入力ハンドルからのドラッグ → そのポートタイプを出力するノードを表示
            const outputs = NODE_OUTPUTS[item.type]
            return outputs && outputs.includes(sourcePortType)
          }
          // 出力ハンドルからのドラッグ → そのポートタイプを受け付けるノードを表示
          const accepts = NODE_ACCEPTS[item.type]
          return accepts && accepts.includes(sourcePortType)
        }),
      })).filter((group) => group.items.length > 0)
    : MENU_ITEMS

  // Adjust position so menu doesn't go off-screen
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  }

  // グループノード右クリック: グループ解除のみ表示
  if (groupNodeId) {
    return (
      <div
        ref={menuRef}
        style={style}
        className="min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_4px_16px_rgba(0,0,0,0.1)] py-1 overflow-hidden"
      >
        <button
          className="w-full flex items-center gap-2.5 px-3 h-8 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-100 text-left"
          onClick={() => onUngroup?.(groupNodeId)}
        >
          <Ungroup size={14} style={{ color: 'var(--text-secondary)' }} />
          グループ解除
        </button>
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      style={style}
      className="min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_4px_16px_rgba(0,0,0,0.1)] py-1 overflow-hidden"
    >
      <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
        {sourcePortType ? '接続先を選択' : 'ノードを追加'}
      </div>
      {filteredGroups.map((group) => (
        <div key={group.category}>
          <div className="px-3 py-1 text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mt-1">
            {group.category}
          </div>
          {group.items.map((item) => (
            <button
              key={item.label}
              className="w-full flex items-center gap-2.5 px-3 h-8 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors duration-100 text-left"
              onClick={() => {
                onSelect(item.type, item.label)
                onClose()
              }}
            >
              <span style={{ color: item.color }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
