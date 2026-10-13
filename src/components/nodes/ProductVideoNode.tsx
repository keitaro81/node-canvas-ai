// 商品訴求動画ノード（2026-10-13）: ショット構成のテンプレートと設定を持つ。入出力ポートは無く、実行は App（SKU ごとに役割別のカットを入れて一括）で行う。
// 役割 = 正面 / 右側面 / 左側面 / 背面 / ディテール / 全身。役割のカットが無い SKU ではそのショットを飛ばす。
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FilmSlate, Plus, Trash, X } from '@phosphor-icons/react'
import { useCanvasStore } from '../../stores/canvasStore'
import type { ProductVideoNodeData } from '../../types/nodes'
import { CUT_ROLES, MAX_SHOTS, SHOT_DURATION_MAX, SHOT_DURATION_MIN, VIDEO_MODEL_LABEL, VIDEO_TEMPLATES, normalizeProductVideoParams, templateById, totalSeconds, type ProductVideoParams, type VideoShotSpec } from '../../lib/video/productVideo'

const ACCENT = '#EC4899'
const FIELD = 'w-full rounded-md px-2 py-1 text-[11px] nodrag focus:outline-none'
const FIELD_STYLE = { background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const

function ProductVideoNodeInner({ id, data, selected }: NodeProps) {
  const updateNode = useCanvasStore((s) => s.updateNode)
  const nodeData = data as unknown as ProductVideoNodeData
  const params = normalizeProductVideoParams(nodeData.params)
  const set = (patch: Partial<ProductVideoParams>) => updateNode(id, { params: { ...params, ...patch } } as Partial<ProductVideoNodeData>)
  const setShot = (i: number, patch: Partial<VideoShotSpec>) => set({ templateId: 'custom', shots: params.shots.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const seconds = totalSeconds(params.shots)

  return (
    <div className="w-[340px] rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: `1px solid ${selected ? ACCENT : 'var(--border)'}`, boxShadow: selected ? `0 0 0 1px ${ACCENT}44` : 'none' }}>
      <div className="flex items-center gap-2 px-3 h-9" style={{ borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${ACCENT}` }}>
        <FilmSlate size={14} style={{ color: ACCENT }} />
        <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{nodeData.label || 'Product Video'}</span>
        <span className="ml-auto text-[10px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{VIDEO_MODEL_LABEL}・{seconds} 秒</span>
        <button className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag" style={{ color: 'var(--text-tertiary)' }} onClick={() => useCanvasStore.getState().removeNode(id)} title="削除"><X size={12} /></button>
      </div>
      <div className="px-3 py-3 flex flex-col gap-2.5">
        <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
          着用カットから商品訴求動画を作る設定です。実行は App で行います（SKU ごとに役割別のカットを入れて「処理する」）。写真の比率のまま、無音、1 SKU 1 本。
        </div>

        {/* テンプレート */}
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>ショット構成</label>
          <select
            className={`${FIELD} appearance-none h-8`}
            style={FIELD_STYLE}
            value={params.templateId}
            onChange={(e) => {
              const tpl = templateById(e.target.value)
              if (tpl) set({ templateId: tpl.id, shots: tpl.shots.map((s) => ({ ...s })) })
              else set({ templateId: 'custom' })
            }}
          >
            {VIDEO_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.description}</option>)}
            <option value="custom">カスタム（自分で並べる）</option>
          </select>
        </div>

        {/* ショット */}
        <div className="flex flex-col gap-1.5">
          {params.shots.map((shot, i) => (
            <div key={i} className="rounded-md px-2 py-1.5 flex flex-col gap-1" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold tabular-nums w-4" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</span>
                <select className="h-7 rounded px-1.5 text-[11px] nodrag appearance-none flex-1" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} value={shot.role} onChange={(e) => setShot(i, { role: e.target.value as VideoShotSpec['role'] })} title="このショットの開始フレームにするカットの役割">
                  {CUT_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <select className="h-7 rounded px-1 text-[11px] nodrag appearance-none" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} value={shot.duration} onChange={(e) => setShot(i, { duration: Number(e.target.value) })} title="秒数">
                  {Array.from({ length: SHOT_DURATION_MAX - SHOT_DURATION_MIN + 1 }, (_, k) => SHOT_DURATION_MIN + k).map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
                <button type="button" className="w-7 h-7 rounded flex items-center justify-center nodrag hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-tertiary)' }} title="このショットを削除" onClick={() => set({ templateId: 'custom', shots: params.shots.filter((_, j) => j !== i) })}><Trash size={11} /></button>
              </div>
              <textarea
                value={shot.motion}
                onChange={(e) => setShot(i, { motion: e.target.value })}
                rows={2}
                placeholder="動き（英語推奨。例: slowly turns to face the camera）"
                className={`${FIELD} resize-none nowheel`}
                style={{ ...FIELD_STYLE, background: 'var(--bg-surface)' }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          ))}
          {params.shots.length < MAX_SHOTS && (
            <button type="button" className="h-7 rounded text-[11px] flex items-center justify-center gap-1 nodrag hover:bg-[var(--bg-elevated)]" style={{ border: '1px dashed var(--border-active)', color: 'var(--text-secondary)' }} onClick={() => set({ templateId: 'custom', shots: [...params.shots, { role: 'front', duration: 3, motion: '' }] })}>
              <Plus size={10} />ショットを追加
            </button>
          )}
        </div>

        {/* 共通の説明・除外 */}
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>共通の説明（各ショットの先頭に付く）</label>
          <textarea value={params.basePrompt} onChange={(e) => set({ basePrompt: e.target.value })} rows={3} className={`${FIELD} resize-none nowheel`} style={FIELD_STYLE} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>避けたいこと（ネガティブ）</label>
          <textarea value={params.negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} rows={2} className={`${FIELD} resize-none nowheel`} style={FIELD_STYLE} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
          費用の目安: 1 SKU あたり約 ${(seconds * 0.1).toFixed(2)}（{seconds} 秒 × $0.10）。役割のカットが無いショットは飛ばします。正面のカットは必須です。
        </div>
      </div>
    </div>
  )
}

export const ProductVideoNode = memo(function ProductVideoNodeWrapper(props: NodeProps) {
  return <div className="group"><ProductVideoNodeInner {...props} /></div>
})
