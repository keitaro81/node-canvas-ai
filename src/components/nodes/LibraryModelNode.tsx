// Model ノード（2026-11-01・ユーザー提案「モデルは単独のノードで」）: ライブラリのモデルを選ぶと、向きごとのカットが出力ポート（out-image-<role>）に出る。
// Try-On の model 入力（服と同じ向きに）や Video Generation の始点・終点につなぐ。一括実行では固定の画像（向きつき）として扱う（計画は src/lib/batch/plan.ts）。
// cuts は保存形式の URL（canonical）で保存し、表示・生成用の署名 URL（outputs[ハンドル id]）は読み込み時に作り直す（Cut Set Input と同じ受け渡し）
import { memo, useEffect, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { UserRound, X } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { ModelPickerDialog } from '../library/ModelPickerDialog'
import { CutRoleIcon } from '../app/CutRoleIcon'
import { MODEL_ROLES } from '../../lib/library/modelRoles'
import { cutSetRoleHandle } from '../../lib/batch/plan'
import { libraryCanonicalUrl, type LibraryItem } from '../../lib/api/library'
import { signMediaRequest } from '../../lib/api/storage'
import type { LibraryModel } from '../../lib/api/libraryModels'
import type { LibraryModelNodeData } from '../../types/nodes'

const ACCENT = '#8B5CF6'
const HEADER_H = 36, ROWS_TOP = HEADER_H + 10, ROW_H = 58

function LibraryModelNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as LibraryModelNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const [pickerOpen, setPickerOpen] = useState(false)
  const cuts = useMemo(() => nodeData.cuts ?? {}, [nodeData.cuts])
  const cutsKey = useMemo(() => JSON.stringify(MODEL_ROLES.map((r) => cuts[r.id]?.url ?? '')), [cuts])

  // 署名 URL（表示と、つないだ先の生成に使う）。保存形式の URL から読み込み時に作り直す
  useEffect(() => {
    let alive = true
    const urls = MODEL_ROLES.map((r) => cuts[r.id]?.url).filter((u): u is string => !!u)
    if (!urls.length) { if (nodeData.outputs && Object.keys(nodeData.outputs).length) updateNode(id, { outputs: {} }); return }
    signMediaRequest({ urls }).then((map) => {
      if (!alive) return
      const outputs: Record<string, string> = {}
      for (const r of MODEL_ROLES) { const u = cuts[r.id]?.url; if (u && map[u]) outputs[cutSetRoleHandle(r.id)] = map[u] }
      updateNode(id, { outputs, status: Object.keys(outputs).length ? 'done' : 'idle' })
    }).catch(() => {})
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutsKey, id, updateNode])

  const onPick = (model: LibraryModel, items: LibraryItem[]) => {
    const byId = new Map(items.map((it) => [it.id, it]))
    const next: LibraryModelNodeData['cuts'] = {}
    for (const r of MODEL_ROLES) { const itemId = model.cuts[r.id]; const it = itemId ? byId.get(itemId) : undefined; if (it) next[r.id] = { itemId: it.id, url: libraryCanonicalUrl(it) } }
    updateNode(id, { modelId: model.id, modelName: model.name, cuts: next, outputs: {} })
  }
  const clear = () => updateNode(id, { modelId: null, modelName: null, cuts: {}, outputs: {}, status: 'idle' })

  return (
    <div className="node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible border transition-all duration-150" style={{ background: 'var(--bg-surface)', borderColor: selected ? ACCENT : 'var(--border)', boxShadow: selected ? `0 0 0 1px ${ACCENT}44` : 'none' }}>
      <div className="flex items-center gap-2 px-3 border-b border-[var(--border)]" style={{ height: HEADER_H, minHeight: HEADER_H, borderLeft: `3px solid ${ACCENT}` }}>
        <UserRound size={14} className="shrink-0" style={{ color: ACCENT }} />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{nodeData.label || 'Model'}</span>
        <button className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag" style={{ color: 'var(--text-tertiary)' }} onClick={() => useCanvasStore.getState().removeNode(id)} title="削除"><X size={12} /></button>
      </div>

      {/* 向きごとの行（右端がそのカットの出力ポート） */}
      <div className="px-3 flex flex-col" style={{ paddingTop: 10, paddingBottom: 4 }}>
        {MODEL_ROLES.map((r) => {
          const url = nodeData.outputs?.[cutSetRoleHandle(r.id)]
          const has = !!cuts[r.id]
          return (
            <div key={r.id} className="flex items-center gap-2" style={{ height: ROW_H }}>
              <div className="shrink-0 rounded overflow-hidden flex items-center justify-center" style={{ width: 38, height: 50, background: 'var(--bg-placeholder)', color: 'var(--text-tertiary)' }}>
                {url ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} /> : <CutRoleIcon role={r.id} size={18} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium" style={{ color: has ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{r.label}</div>
                <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{has ? (url ? '出力に出ています' : '署名中…') : nodeData.modelId ? 'このモデルにはありません' : 'モデルを選ぶと入ります'}</div>
              </div>
            </div>
          )
        })}
      </div>
      {MODEL_ROLES.map((r, i) => (
        <Handle key={r.id} id={cutSetRoleHandle(r.id)} type="source" position={Position.Right} className="handle-image" title={`${r.label}のカット`} style={{ top: ROWS_TOP + i * ROW_H + ROW_H / 2, width: 20, height: 20 }} />
      ))}

      <div className="px-3 pb-3 flex flex-col gap-2 nodrag">
        <div className="flex items-center gap-2">
          <button className="flex-1 h-8 rounded-lg text-[12px] font-medium text-white hover:opacity-90" style={{ background: ACCENT }} onClick={() => setPickerOpen(true)}>{nodeData.modelId ? 'モデルを変更' : 'モデルを選ぶ'}</button>
          {nodeData.modelId && <button className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-tertiary)', border: '1px solid var(--border)' }} title="モデルを外す" onClick={clear}><X size={12} /></button>}
        </div>
        <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>{nodeData.modelName ? `${nodeData.modelName}。` : ''}向きのポートを Try-On の「モデル」（服と同じ向き）や Video Generation の開始・終了フレームにつなぎます。一括実行では固定のモデルとして使われます。</div>
      </div>
      <ModelPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={onPick} />
    </div>
  )
}

export const LibraryModelNode = memo(function LibraryModelNodeWrapper(props: NodeProps) {
  return <div className="group"><LibraryModelNodeInner {...props} /></div>
})
