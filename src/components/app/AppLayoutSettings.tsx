// App モードのサイドバー「レイアウト設定」（フェーズ C(c) 追補）: キャンバスの Product Layout ノードをここから直接編集する。
// 変更はキャンバスのノードに入り（通常の自動保存で保存）、右の結果欄にその場で反映される（fal は呼ばない）。
// 変更できるのはキャンバスを編集できる人だけ（所有者 / 編集を許可されたメンバーが編集を始めたとき）。それ以外は閲覧のみ。
import { useMemo, useState } from 'react'
import type { Edge } from '@xyflow/react'
import { CaretDown, CaretRight, Plus, Trash, X } from '@phosphor-icons/react'
import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import { useWorkflowStore, selectCanEditNow, selectLockRequired } from '../../stores/workflowStore'
import { LayoutParamsForm } from '../nodes/pp/LayoutParamsForm'
import { DEFAULT_LAYOUT_PARAMS, normalizeLayoutParams } from '../../lib/layout/computeLayout'
import { addLayoutNodeToCanvas, newLayoutNodeId, type CanvasLike } from '../../lib/review/model'
import { appCanvasOf } from '../../lib/apps/appKind'
import type { LayoutParams, NodeData } from '../../types/nodes'

const ACCENT = '#14B8A6'
const LAYOUT_W = 300, LAYOUT_H = 720, GROUP_PAD = 40   // 足した Product Layout がグループに収まる大きさ

/** groupId = App 化したグループ（その中の Product Layout だけを出し、追加もグループの中へ。2026-11-02 メモ 45）。無ければキャンバス全体（救済） */
export function AppLayoutSettings({ groupId = null }: { groupId?: string | null }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const updateNode = useCanvasStore((s) => s.updateNode)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const pasteNodes = useCanvasStore((s) => s.pasteNodes)
  const canEdit = useWorkflowStore(selectCanEditNow)
  const lockRequired = useWorkflowStore(selectLockRequired)
  const canEditWorkflow = useWorkflowStore((s) => s.currentWorkflowCanEdit)
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const scoped = useMemo(() => appCanvasOf(nodes, edges, groupId), [nodes, edges, groupId])
  const layouts = useMemo(() => scoped.nodes.filter((n) => (n.data as unknown as NodeData).type === 'productLayout'), [scoped])
  const hasCutout = useMemo(() => scoped.nodes.some((n) => (n.data as unknown as NodeData).type === 'removeBackground'), [scoped])

  const readOnlyReason = canEdit ? null
    : !canEditWorkflow ? 'レイアウトを変更できるのはワークフローの所有者と、編集を許可されたチームのメンバーだけです。ここでは設定の確認のみ。'
    : lockRequired ? '変更するには右上の「編集する」で編集を始めてください（他の人が編集中のときは待ちます）。'
    : 'いまは変更できません。'

  const setParams = (id: string, current: LayoutParams, patch: Partial<LayoutParams>) => {
    if (!canEdit) return
    updateNode(id, { params: { ...current, ...patch } } as Partial<NodeData>)
  }

  const addVariant = () => {
    if (!canEdit) return
    const nodeId = newLayoutNodeId()
    // 位置はグループの中の座標（子ノードはグループからの相対位置）。つなぐ切り抜きもグループの中の Remove Background
    const canvas: CanvasLike = {
      nodes: scoped.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data as unknown as Record<string, unknown> })),
      edges: scoped.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null })),
    }
    const { canvas: next } = addLayoutNodeToCanvas(canvas, { ...DEFAULT_LAYOUT_PARAMS, variantName: `variant_${layouts.length + 1}` }, nodeId)
    const added = next.nodes.find((n) => n.id === nodeId)
    if (!added) return
    // 切り抜き → 新しい Product Layout と、Product Layout → Export（ほかのバリアントと同じ Export・2026-11-02 メモ 66）
    const addedEdges = next.edges.filter((e) => e.target === nodeId || e.source === nodeId)
    pasteNodes(
      [{ id: added.id, type: added.type, position: added.position ?? { x: 0, y: 0 }, data: added.data as unknown as NodeData, ...(groupId ? { parentId: groupId, extent: 'parent' as const } : {}) } as AppNode],
      addedEdges.map((e) => ({ id: e.id ?? `e-${e.source}-${e.target}`, source: e.source, sourceHandle: e.sourceHandle ?? undefined, target: e.target, targetHandle: e.targetHandle ?? undefined, style: (e.style as Edge['style']) ?? { stroke: ACCENT, strokeWidth: 2 } } as Edge)),
    )
    // グループを広げて、足したノードが収まるようにする
    if (groupId) {
      const pos = added.position ?? { x: 0, y: 0 }
      useCanvasStore.setState((state) => ({
        nodes: state.nodes.map((n) => {
          if (n.id !== groupId) return n
          const w = (n.style?.width as number | undefined) ?? 400, h = (n.style?.height as number | undefined) ?? 300
          const needW = pos.x + LAYOUT_W + GROUP_PAD, needH = pos.y + LAYOUT_H + GROUP_PAD
          return needW > w || needH > h ? { ...n, style: { ...n.style, width: Math.max(w, needW), height: Math.max(h, needH) } } : n
        }),
      }))
    }
    setOpenId(nodeId)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>レイアウト設定 <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>（バリアント {layouts.length}）</span></div>
        {canEdit && (
          <button type="button" onClick={addVariant} className="flex items-center gap-1 h-7 px-2 rounded-md text-[11px] hover:bg-[var(--bg-elevated)]" style={{ color: ACCENT, border: `1px solid ${ACCENT}55` }} title="Product Layout ノードを追加して切り抜きにつなぐ">
            <Plus size={12} />バリアントを追加
          </button>
        )}
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
        キャンバスの Product Layout ノードの設定です。変えると右の結果に反映され、ワークフローに保存されます（切り抜きの再実行は不要）。
      </p>
      {readOnlyReason && <div className="rounded-md px-2 py-1.5 text-[11px]" style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>{readOnlyReason}</div>}
      {!hasCutout && <div className="rounded-md px-2 py-1.5 text-[11px]" style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.12)' }}>Remove Background が無いため、レイアウトは描けません。</div>}
      {layouts.length === 0 && <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>バリアントがありません。{canEdit ? '「バリアントを追加」で作れます。' : ''}</div>}
      {layouts.map((n) => {
        const params = normalizeLayoutParams((n.data as unknown as NodeData).params)
        const open = openId === n.id
        return (
          <div key={n.id} className="rounded-lg" style={{ border: `1px solid ${open ? ACCENT : 'var(--border)'}`, background: 'var(--bg-canvas)' }}>
            <div className="flex items-center gap-2 px-2 h-9 cursor-pointer select-none" onClick={() => setOpenId(open ? null : n.id)}>
              {open ? <CaretDown size={12} style={{ color: 'var(--text-tertiary)' }} /> : <CaretRight size={12} style={{ color: 'var(--text-tertiary)' }} />}
              <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{params.variantName}</span>
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{params.width}×{params.height}</span>
              <div className="flex-1" />
              {canEdit && (confirmId === n.id ? (
                <span className="flex items-center gap-1 text-[11px] shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="h-6 px-2 rounded text-white whitespace-nowrap" style={{ background: '#EF4444' }} title="このバリアントを削除する" onClick={() => { removeNode(n.id); setConfirmId(null); if (openId === n.id) setOpenId(null) }}>削除</button>
                  <button type="button" className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }} title="やめる" aria-label="やめる" onClick={() => setConfirmId(null)}><X size={12} /></button>
                </span>
              ) : (
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-tertiary)' }} title="このバリアント（Product Layout ノード）を削除" onClick={(e) => { e.stopPropagation(); setConfirmId(n.id) }}><Trash size={12} /></button>
              ))}
            </div>
            {open && (
              <div className="px-2 pb-2" style={{ pointerEvents: canEdit ? 'auto' : 'none', opacity: canEdit ? 1 : 0.7 }}>
                <LayoutParamsForm params={params} onChange={(patch) => setParams(n.id, params, patch)} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
