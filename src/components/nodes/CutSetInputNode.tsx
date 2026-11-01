// Cut Set Input ノード（2026-10-31・設計 docs/specs/product-video-nodes.md §4.1）: 1 アイテム = 1 SKU の役割別カット（正面 / 右側面 / 左側面 / 背面 / ディテール / 全身）。
// 出力ポートは役割ごと（画像）+ カット一式（elements 用）+ アイテム情報。対話実行では ★ の 1 SKU のカットを署名して outputs[ハンドル id] に出す。
// 「一括実行…」で準備完了の全 SKU をジョブとして投入（Batch Input と同じ確認ダイアログ）。カードの UI は App と共用（CutSetCards）
import { Fragment, memo, useEffect, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { PortLabel } from './PortLabel'
import { dimIfNotTarget, useDragTarget } from './portDrag'
import { Clapperboard, X } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useBatchStore } from '../../stores/batchStore'
import { useLiveCanvas } from '../../hooks/useLiveCanvas'
import { signBatchPaths } from '../../lib/cutout/store'
import { CUT_ROLES, FRONTAL_ROLE } from '../../lib/video/productVideo'
import { CUT_SET_ITEM_HANDLE, CUT_SET_SET_HANDLE, cutSetRoleHandle, shotsFromCanvas, type WorkflowSnapshot } from '../../lib/batch/plan'
import { stripExtension } from '../../lib/batch/items'
import { CutSetCards } from '../app/CutSetCards'
import { cardsFromItems, cardsToItems, itemsFromCards, type SkuCard } from '../../lib/video/cutSet'
import type { CutSetInputNodeData } from '../../types/nodes'

const ACCENT = '#EC4899'
const HEADER_H = 36, PORTS_TOP = HEADER_H + 10, PORT_ROW_H = 22
const PORTS: Array<{ id: string; label: string; cls: string }> = [
  ...CUT_ROLES.map((r) => ({ id: cutSetRoleHandle(r.id), label: r.label, cls: 'handle-image' })),
  { id: CUT_SET_SET_HANDLE, label: 'カット一式（参照カット）', cls: 'handle-cuts' },
  { id: CUT_SET_ITEM_HANDLE, label: 'アイテム情報（SKU）', cls: 'handle-item' },
]

function CutSetInputNodeInner({ id, data, selected }: NodeProps) {
  const drag = useDragTarget(id, 'cutSetInputNode')   // 線のドラッグ中: 候補のポートに名前・合わないポートは薄く（メモ 31）
  const nodeData = data as unknown as CutSetInputNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const live = useLiveCanvas()
  // キャンバスの構成（このノードのカットを始点にする Video Generation）→ 使う役割の枠
  const shots = useMemo(() => shotsFromCanvas(live as unknown as WorkflowSnapshot), [live])
  // カードは画面の状態（アップロード中などの一時状態を含む）。ready なカットだけをノードに保存する
  const [cards, setCards] = useState<SkuCard[]>(() => cardsFromItems(nodeData.items))
  const current = cards.find((c) => c.id === nodeData.currentItemId) ?? cards[0] ?? null
  const readyCount = cardsToItems(cards).length
  const uploading = cards.some((c) => CUT_ROLES.some((r) => c.cuts[r.id].status === 'uploading'))

  // 保存形（items）の同期
  const itemsKey = useMemo(() => JSON.stringify(itemsFromCards(cards)), [cards])
  useEffect(() => { updateNode(id, { items: JSON.parse(itemsKey) }) }, [itemsKey, id, updateNode])

  // ★ の SKU の出力: 役割ごとの署名 URL と SKU（アイテム情報）
  const currentKey = current ? `${current.id}|${current.sku}|${CUT_ROLES.map((r) => current.cuts[r.id].status === 'ready' ? current.cuts[r.id].path ?? '' : '').join('|')}` : ''
  useEffect(() => {
    let alive = true
    if (!current) { updateNode(id, { currentItemId: null, outputs: {}, itemInfo: undefined, status: 'idle' }); return }
    const ready = CUT_ROLES.map((r) => current.cuts[r.id]).filter((s) => s.status === 'ready' && !!s.path)
    const front = current.cuts[FRONTAL_ROLE]
    const index = Math.max(1, cards.findIndex((c) => c.id === current.id) + 1)
    const itemInfo = { sku: current.sku.trim() || 'item', original: stripExtension(front.name ?? `${current.sku || 'item'}.jpg`), index }
    if (!ready.length) { updateNode(id, { currentItemId: current.id, outputs: {}, itemInfo, status: 'idle' }); return }
    signBatchPaths(ready.map((s) => s.path as string)).then((map) => {
      if (!alive) return
      const outputs: Record<string, string> = {}
      for (const s of ready) { const u = map[s.path as string]; if (u) outputs[cutSetRoleHandle(s.role)] = u }
      updateNode(id, { currentItemId: current.id, outputs, itemInfo, status: outputs[cutSetRoleHandle(FRONTAL_ROLE)] ? 'done' : 'idle' })
    }).catch(() => {})
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, id, updateNode])

  return (
    <div className="node-popin relative flex flex-col w-[360px] rounded-xl overflow-visible border transition-all duration-150" style={{ background: 'var(--bg-surface)', borderColor: selected ? ACCENT : 'var(--border)', boxShadow: selected ? `0 0 0 1px ${ACCENT}44` : 'none' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 border-b border-[var(--border)]" style={{ height: HEADER_H, minHeight: HEADER_H, borderLeft: `3px solid ${ACCENT}` }}>
        <Clapperboard size={14} className="shrink-0" style={{ color: ACCENT }} />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{nodeData.label || 'Cut Set Input'}</span>
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>{cards.length} SKU</span>
        <button className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag" style={{ color: 'var(--text-tertiary)' }} onClick={() => useCanvasStore.getState().removeNode(id)} title="削除"><X size={12} /></button>
      </div>

      {/* 出力ポート（役割ごと + カット一式 + アイテム情報）。ハンドルは各行の右端 */}
      <div className="px-3 flex flex-col" style={{ paddingTop: 10, paddingBottom: 6 }}>
        {PORTS.map((p) => {
          const has = !!nodeData.outputs?.[p.id]
          return (
            <div key={p.id} className="flex items-center justify-end gap-2 text-[11px]" style={{ height: PORT_ROW_H, color: p.id === CUT_SET_SET_HANDLE || p.id === CUT_SET_ITEM_HANDLE || has ? 'var(--text-primary)' : 'var(--text-tertiary)' }} title={p.id === CUT_SET_SET_HANDLE ? '正面 + 別角度（最大 3）を Video Generation の参照カットに' : p.id === CUT_SET_ITEM_HANDLE ? 'SKU・連番（Export の命名用）' : `${p.label}のカット（★ の SKU）`}>
              <span>{p.label}</span>
            </div>
          )
        })}
      </div>
      {PORTS.map((p, i) => (
        <Fragment key={p.id}>
          <Handle id={p.id} type="source" position={Position.Right} className={p.cls} title={p.label} style={{ top: PORTS_TOP + i * PORT_ROW_H + PORT_ROW_H / 2, width: 20, height: 20, ...dimIfNotTarget(drag, drag.outputOk(p.id)) }} />
          <PortLabel top={PORTS_TOP + i * PORT_ROW_H + PORT_ROW_H / 2} at="output" text={p.label} show={drag.outputOk(p.id)} />
        </Fragment>
      ))}

      <div className="px-3 pb-3 flex flex-col gap-2.5 nodrag">
        <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
          1 SKU（商品の管理番号）= 1 つの商品の向きごとの写真（正面は必須）。Video Generation に直接つなぐ商品動画では同じ人物が同じ服を着た写真、Try-On を経由する構成では服の写真（側面・背面は誰かが着た写真でよい）を入れます。向きのポートを Video Generation の開始・終了フレームに、カット一式を参照カットにつなぎます。対話実行は ★ の SKU だけ、全 SKU は「一括実行」で。
        </div>
        <div className="nowheel nopan overflow-auto" style={{ maxHeight: 520 }}>
          <CutSetCards nodeId={id} shots={shots} cards={cards} onChange={setCards} currentId={current?.id ?? null} onMakeCurrent={(cid) => updateNode(id, { currentItemId: cid })} compact />
        </div>
        <button
          className="h-8 w-full rounded-lg text-[12px] font-medium text-white nodrag disabled:opacity-50 transition-opacity hover:opacity-90"
          style={{ background: ACCENT }}
          disabled={readyCount === 0 || uploading}
          title={uploading ? 'アップロードが終わるまで待ってください' : readyCount === 0 ? '正面のカットがある SKU がありません' : '準備完了の全 SKU を一括実行する'}
          onClick={() => useBatchStore.getState().openSubmitDialog(id)}
        >
          一括実行…（{readyCount} 件）
        </button>
      </div>
    </div>
  )
}

export const CutSetInputNode = memo(function CutSetInputNodeWrapper(props: NodeProps) {
  return <div className="group"><CutSetInputNodeInner {...props} /></div>
})
