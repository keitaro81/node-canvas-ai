import { memo, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { NodeResizer } from '@xyflow/react'
import { StickyNote, X, Eye, Edit3 } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import type { NodeData } from '../../types/nodes'

const NOTE_COLORS = {
  yellow: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', accent: '#F59E0B' },
  green:  { bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.35)',  accent: '#22C55E' },
  blue:   { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.35)', accent: '#6366F1' },
  pink:   { bg: 'rgba(236,72,153,0.10)', border: 'rgba(236,72,153,0.35)', accent: '#EC4899' },
} as const

type NoteColor = keyof typeof NOTE_COLORS

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return <span key={i}>{part}</span>
  })
}

function renderMarkdown(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('# ')) {
      return (
        <div key={i} className="text-[15px] font-bold text-[#FAFAFA] mt-1">
          {line.slice(2)}
        </div>
      )
    }
    if (line.startsWith('## ')) {
      return (
        <div key={i} className="text-[13px] font-semibold text-[#FAFAFA] mt-1">
          {line.slice(3)}
        </div>
      )
    }
    if (line.startsWith('- ')) {
      return (
        <div key={i} className="flex gap-1.5 text-[12px] text-[#E4E4E7]">
          <span className="text-[#A1A1AA] flex-shrink-0 mt-0.5">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
    }
    if (line === '') {
      return <div key={i} className="h-1.5" />
    }
    return (
      <div key={i} className="text-[12px] text-[#E4E4E7] leading-relaxed">
        {renderInline(line)}
      </div>
    )
  })
}

export const NoteNode = memo(function NoteNode(props: NodeProps) {
  const { id, data: rawData, selected, width, height } = props
  const data = rawData as NodeData
  const removeNode = useCanvasStore((s) => s.removeNode)
  const updateNode = useCanvasStore((s) => s.updateNode)

  const [isEditing, setIsEditing] = useState(true)

  const noteColor = ((data.params?.color as NoteColor) in NOTE_COLORS
    ? (data.params?.color as NoteColor)
    : 'yellow')
  const colors = NOTE_COLORS[noteColor]
  const content = (data.params?.content as string) ?? ''

  const w = width ?? 280
  const h = height ?? 160

  return (
    <div
      className="group"
      style={{
        width: w,
        height: h,
        background: colors.bg,
        border: `1px solid ${selected ? colors.accent : colors.border}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: selected ? `0 0 0 1px ${colors.accent}44` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      <NodeResizer
        minWidth={200}
        minHeight={100}
        isVisible={selected}
        lineStyle={{ stroke: colors.accent, strokeWidth: 1 }}
        handleStyle={{
          background: colors.accent,
          border: 'none',
          borderRadius: 3,
          width: 8,
          height: 8,
        }}
      />

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 flex-shrink-0"
        style={{ height: 36, borderBottom: `1px solid ${colors.border}` }}
      >
        <StickyNote size={14} style={{ color: colors.accent, flexShrink: 0 }} />
        <span className="flex-1 text-[13px] font-semibold text-[#FAFAFA] truncate">
          {data.label}
        </span>

        {/* Color picker dots */}
        <div className="flex gap-1 items-center">
          {(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => (
            <button
              key={c}
              className="rounded-full transition-transform nodrag"
              style={{
                width: 10,
                height: 10,
                background: NOTE_COLORS[c].accent,
                transform: noteColor === c ? 'scale(1.4)' : 'scale(1)',
                outline: noteColor === c ? `2px solid ${NOTE_COLORS[c].accent}` : 'none',
                outlineOffset: 1,
              }}
              onClick={() => updateNode(id, { params: { ...data.params, color: c } })}
              onMouseDown={(e) => e.stopPropagation()}
              title={c}
            />
          ))}
        </div>

        {/* Edit / Preview toggle */}
        <button
          className="w-[22px] h-[22px] flex items-center justify-center rounded transition-all duration-150 nodrag"
          style={{ color: '#A1A1AA' }}
          onClick={() => setIsEditing((v) => !v)}
          onMouseDown={(e) => e.stopPropagation()}
          title={isEditing ? 'プレビュー' : '編集'}
        >
          {isEditing ? <Eye size={12} /> : <Edit3 size={12} />}
        </button>

        {/* Delete */}
        <button
          className="opacity-0 group-hover:opacity-100 w-[22px] h-[22px] flex items-center justify-center rounded transition-all duration-150 nodrag"
          style={{ color: '#71717A' }}
          onClick={() => removeNode(id)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {isEditing ? (
          <textarea
            className="w-full h-full resize-none p-3 text-[12px] text-[#FAFAFA] placeholder-[#71717A] focus:outline-none nodrag"
            style={{ background: 'transparent', border: 'none' }}
            placeholder="メモを入力... (Markdown対応: # 見出し、**太字**、- リスト)"
            value={content}
            onChange={(e) =>
              updateNode(id, { params: { ...data.params, content: e.target.value } })
            }
          />
        ) : (
          <div className="w-full h-full overflow-y-auto p-3">
            {content ? (
              <div className="flex flex-col gap-0.5">{renderMarkdown(content)}</div>
            ) : (
              <span className="text-[12px] text-[#71717A]">
                メモを入力... (Markdown対応)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
