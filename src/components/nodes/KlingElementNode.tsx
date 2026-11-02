// Kling Element（参照一式・2026-11-02 メモ 42 案 B）: 同じ服・人物を正面と別の角度から写した写真をまとめ、
// Kling v3 Pro の Video Generation の「参照一式」ポートにつなぐ。写真はポートでつなぐだけ（Reference Image・Model・Try-On の出力など）。
// 一覧は表示だけで、生成のときは Video Generation がつないだ写真を集める（lib/video/klingElement.ts）
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Layers } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { useCanvasStore } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSignedMedia } from '../../hooks/useSignedMedia'
import { getImageUrlFromNodeData } from '../../lib/utils'
import { KLING_ELEMENT_SLOTS } from '../../lib/video/klingElement'
import type { NodeData } from '../../types/nodes'

function SlotRow({ label, raw, sourceLabel }: { label: string; raw: string | null; sourceLabel: string | null }) {
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const { url } = useSignedMedia(raw, workflowId)
  return (
    <div className="flex items-center gap-2 rounded-md p-1.5" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
      <div className="shrink-0 rounded overflow-hidden flex items-center justify-center" style={{ width: 36, height: 48, background: 'var(--bg-placeholder)' }}>
        {url ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} /> : null}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
        <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{sourceLabel ?? '未接続'}</div>
      </div>
    </div>
  )
}

function KlingElementNodeInner(props: NodeProps) {
  const { id } = props
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const rows = KLING_ELEMENT_SLOTS.map((slot) => {
    const e = edges.find((x) => x.target === id && x.targetHandle === slot.handle)
    const src = e ? nodes.find((n) => n.id === e.source) : undefined
    return { slot, raw: src ? getImageUrlFromNodeData(src.data, e?.sourceHandle) : null, sourceLabel: src ? String((src.data as { label?: unknown }).label ?? '') || '接続あり' : null }
  })
  const hasFrontal = !!rows[0].sourceLabel
  const refCount = rows.slice(1).filter((r) => r.sourceLabel).length
  return (
    <BaseNode
      {...props}
      data={props.data as unknown as NodeData}
      icon={<Layers size={14} />}
      hideStatus
      inputs={KLING_ELEMENT_SLOTS.map((s) => ({ id: s.id, portType: 'image' as const, label: s.label }))}
      outputs={[{ id: 'element', portType: 'element', label: '参照一式' }]}
    >
      <div className="flex flex-col gap-1.5 nodrag">
        <p className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
          同じ服や人物を、正面と別の角度から写した写真をまとめます。Kling v3 Pro の Video Generation の「参照一式」につなぐと、動画の途中で見える面の形や柄が崩れにくくなります。始点の画像に写っているものを選んでください。
        </p>
        {rows.map((r) => <SlotRow key={r.slot.id} label={r.slot.label} raw={r.raw} sourceLabel={r.sourceLabel} />)}
        {(!hasFrontal || refCount === 0) && (
          <div className="text-[10px] leading-snug px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.10)', color: '#F59E0B' }}>
            正面と、別の角度の写真を 1 枚以上つないでください（足りないと参照一式は使われません）
          </div>
        )}
      </div>
    </BaseNode>
  )
}

export const KlingElementNode = memo(KlingElementNodeInner)
