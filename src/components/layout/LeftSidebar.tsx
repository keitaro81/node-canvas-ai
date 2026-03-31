import { useState } from 'react'
import { ChevronLeft, ChevronRight, Type, Wrench, Sparkles, StickyNote, Layers, PanelLeft, Film, Wand2, ImagePlus } from 'lucide-react'
import type { NodeType } from '../../types/nodes'
import { WorkflowListPanel } from '../panels/WorkflowListPanel'

interface NodeDef {
  type: NodeType
  label: string
  description: string
  icon: React.ReactNode
  color: string
}

const PALETTE: Array<{ category: string; color: string; items: NodeDef[] }> = [
  {
    category: 'Text',
    color: '#6366F1',
    items: [
      {
        type: 'textPrompt',
        label: 'Text Prompt',
        description: 'テキストプロンプトを入力',
        icon: <Type size={14} />,
        color: '#6366F1',
      },
      {
        type: 'promptEnhancer',
        label: 'Prompt Enhancer',
        description: 'AIがプロンプトを最適化',
        icon: <Wand2 size={14} />,
        color: '#6366F1',
      },
    ],
  },
  {
    category: 'Image',
    color: '#8B5CF6',
    items: [
      {
        type: 'imageGen',
        label: 'Image Generation',
        description: 'AI画像を生成',
        icon: <Sparkles size={14} />,
        color: '#8B5CF6',
      },
      {
        type: 'referenceImage',
        label: 'Reference Image',
        description: '参照画像をアップロード',
        icon: <ImagePlus size={14} />,
        color: '#8B5CF6',
      },
    ],
  },
  {
    category: 'Video',
    color: '#EC4899',
    items: [
      {
        type: 'videoGen',
        label: 'Video Generation',
        description: 'AI動画を生成',
        icon: <Film size={14} />,
        color: '#EC4899',
      },
    ],
  },
  {
    category: 'Utility',
    color: '#6B7280',
    items: [
      {
        type: 'note',
        label: 'Note',
        description: 'メモ・注釈を追加',
        icon: <StickyNote size={14} />,
        color: '#F59E0B',
      },
      {
        type: 'utility',
        label: 'Utility',
        description: 'ユーティリティノード',
        icon: <Wrench size={14} />,
        color: '#6B7280',
      },
    ],
  },
]

type TabId = 'palette' | 'workflows'

interface LeftSidebarProps {
  open: boolean
  onToggle: () => void
}

export function LeftSidebar({ open, onToggle }: LeftSidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>('palette')

  function handleDragStart(e: React.DragEvent, node: NodeDef) {
    e.dataTransfer.setData(
      'application/node-palette',
      JSON.stringify({ type: node.type, label: node.label })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="relative flex shrink-0" style={{ zIndex: 10 }}>
      {/* Sidebar panel */}
      <div
        className="flex flex-col border-r border-[#27272A] overflow-hidden"
        style={{
          width: open ? 240 : 0,
          background: '#18181B',
          transition: 'width 200ms ease-out',
        }}
      >
        <div style={{ width: 240 }} className="flex flex-col h-full">
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-2 pt-2 pb-0 border-b border-[#27272A]">
            <button
              onClick={() => setActiveTab('palette')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-t text-[11px] font-medium transition-colors duration-150"
              style={{
                color: activeTab === 'palette' ? '#FAFAFA' : '#71717A',
                borderBottom: activeTab === 'palette' ? '2px solid #8B5CF6' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              <PanelLeft size={12} />
              Nodes
            </button>
            <button
              onClick={() => setActiveTab('workflows')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-t text-[11px] font-medium transition-colors duration-150"
              style={{
                color: activeTab === 'workflows' ? '#FAFAFA' : '#71717A',
                borderBottom: activeTab === 'workflows' ? '2px solid #8B5CF6' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              <Layers size={12} />
              Workflows
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'palette' ? (
              <div className="flex flex-col h-full">
                <div className="px-3 pt-3 pb-2">
                  <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-wider">
                    Node Palette
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-3">
                  {PALETTE.map((group) => (
                    <div key={group.category} className="mb-4">
                      <div className="flex items-center gap-1.5 px-1 mb-1.5">
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: group.color }}
                        />
                        <span className="text-[10px] font-medium text-[#71717A] uppercase tracking-wider">
                          {group.category}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        {group.items.map((node) => (
                          <div
                            key={node.type}
                            draggable
                            onDragStart={(e) => handleDragStart(e, node)}
                            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-[#27272A] cursor-grab active:cursor-grabbing hover:border-[#3F3F46] hover:bg-[#1E1E22] transition-all duration-150 select-none"
                            style={{ background: '#111113' }}
                          >
                            <div
                              className="shrink-0 w-6 h-6 rounded flex items-center justify-center"
                              style={{ background: `${node.color}22`, color: node.color }}
                            >
                              {node.icon}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-[12px] font-medium text-[#FAFAFA] leading-tight truncate">
                                {node.label}
                              </span>
                              <span className="text-[11px] text-[#71717A] leading-tight truncate">
                                {node.description}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <WorkflowListPanel />
            )}
          </div>
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute top-3 flex items-center justify-center w-5 h-8 rounded-r border border-l-0 border-[#27272A] hover:bg-[#1E1E22] transition-colors duration-150"
        style={{
          left: open ? 240 : 0,
          background: '#18181B',
          transition: 'left 200ms ease-out',
          zIndex: 1,
        }}
        title={open ? 'Close palette' : 'Open palette'}
      >
        {open ? (
          <ChevronLeft size={12} style={{ color: '#71717A' }} />
        ) : (
          <ChevronRight size={12} style={{ color: '#71717A' }} />
        )}
      </button>
    </div>
  )
}
