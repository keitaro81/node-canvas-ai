import { useEffect, useLayoutEffect, useRef } from 'react'
import { Type, Sparkles, StickyNote, Film, ImagePlus, Wand2, Ungroup, Video, List, Camera, Scissors, LayoutTemplate, Images, Download, LayoutGrid, Shirt, UserRound, Layers } from 'lucide-react'
import type { NodeType, PortType } from '../../types/nodes'
import { isCompatibleFor } from '../../stores/canvasStore'

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
  list:           ['image', 'text', 'video'],
  cameraList:     [],
  removeBackground: ['image'],
  productLayout:  ['cutout', 'image'],
  batchInput:     [],
  export:         ['image', 'item', 'video'],
  batchResults:   [],
  videoMerge:     ['video'],
  tryOn:          ['image', 'cutout'],
  libraryModel:   [],
  imageGen:       ['text', 'image', 'list'],
  videoGen:       ['text', 'image', 'video', 'list', 'element'],
  klingElement:   ['image'],
  note:           [],
  utility:        ['text'],
}

// ノードタイプが出力するポートタイプ（空配列 = 出力なし）
const NODE_OUTPUTS: Partial<Record<NodeType, string[]>> = {
  textPrompt:     ['text'],
  promptEnhancer: ['text'],
  list:           ['list'],
  cameraList:     ['list'],
  removeBackground: ['cutout'],
  productLayout:  ['image'],
  batchInput:     ['image', 'item'],
  export:         [],
  batchResults:   [],
  videoMerge:     ['video'],
  tryOn:          ['image'],
  libraryModel:   ['image'],
  imageGen:       ['image'],
  referenceImage: ['image'],
  videoGen:       ['video'],
  referenceVideo: ['video'],
  klingElement:   ['element'],
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
      { type: 'tryOn',          label: 'Try-On',           icon: <Shirt size={14} />,     color: '#8B5CF6' },
      { type: 'libraryModel',   label: 'Model',            icon: <UserRound size={14} />, color: '#8B5CF6' },
    ],
  },
  {
    category: 'Video',
    items: [
      { type: 'videoGen',       label: 'Video Generation', icon: <Film size={14} />,  color: '#EC4899' },
      { type: 'referenceVideo', label: 'Reference Video',  icon: <Video size={14} />, color: '#EC4899' },
      { type: 'klingElement',   label: 'Kling Element',    icon: <Layers size={14} />, color: '#EC4899' },
      { type: 'videoMerge',     label: 'Video Merge',      icon: <Film size={14} />,  color: '#EC4899' },
    ],
  },
  {
    category: 'Utility',
    items: [
      { type: 'list',       label: 'List',         icon: <List size={14} />,   color: '#8B5CF6' },
      { type: 'cameraList', label: 'Camera List',  icon: <Camera size={14} />, color: '#8B5CF6' },
      { type: 'note',       label: 'Note',         icon: <StickyNote size={14} />, color: '#F59E0B' },
    ],
  },
  {
    category: '撮影後工程',
    items: [
      { type: 'removeBackground', label: 'Remove Background', icon: <Scissors size={14} />, color: '#14B8A6' },
      { type: 'productLayout',    label: 'Product Layout',    icon: <LayoutTemplate size={14} />, color: '#14B8A6' },
      { type: 'batchInput',       label: 'Batch Input',       icon: <Images size={14} />, color: '#14B8A6' },
      { type: 'export',           label: 'Export',            icon: <Download size={14} />, color: '#14B8A6' },
      { type: 'batchResults',     label: 'Batch Results',     icon: <LayoutGrid size={14} />, color: '#14B8A6' },
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
  sourceNodeType?: string   // 線を引き始めたノードの React Flow の種類（入力から逆に引いたときの相性の判定に使う）
  groupNodeId?: string
  onUngroup?: (groupId: string) => void
}

// 相性の判定に要る React Flow の種類（切り抜き → 画像 は Image Generation と Try-On だけ）
const RF_TYPE_OF: Partial<Record<NodeType, string>> = { imageGen: 'imageGenerationNode', tryOn: 'tryOnNode' }

export function ContextMenu({ x, y, onSelect, onClose, sourcePortType, sourceIsInput, sourceNodeType, groupNodeId, onUngroup }: ContextMenuProps) {
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
            // 入力ハンドルからのドラッグ → その入力につなげる出力を持つノード（つなぐときの判定 isCompatibleFor と同じ規則）
            const outputs = NODE_OUTPUTS[item.type] ?? []
            return outputs.some((t) => isCompatibleFor(t as PortType, sourcePortType, sourceNodeType))
          }
          // 画像から Product Layout を出すと「背景画像」につながり、商品の写真が背景に入るので候補にしない（背景は背景のポートへ直接・2026-11-02 メモ 41c）
          if (item.type === 'productLayout' && sourcePortType === 'image') return false
          // 出力ハンドルからのドラッグ → その出力を受けられる入力を持つノード（切り抜き → Image Generation も出す・メモ 41a）
          const accepts = NODE_ACCEPTS[item.type] ?? []
          return accepts.some((t) => isCompatibleFor(sourcePortType, t as PortType, RF_TYPE_OF[item.type]))
        }),
      })).filter((group) => group.items.length > 0)
    : MENU_ITEMS

  // 画面外にはみ出す場合は描画前に位置を補正する（DOM計測が必要なため useLayoutEffect で直接スタイルを更新）
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const adjustedX = x + rect.width > window.innerWidth ? x - rect.width : x
    const adjustedY = y + rect.height > window.innerHeight ? y - rect.height : y
    el.style.left = `${Math.max(0, adjustedX)}px`
    el.style.top = `${Math.max(0, adjustedY)}px`
  }, [x, y])

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
