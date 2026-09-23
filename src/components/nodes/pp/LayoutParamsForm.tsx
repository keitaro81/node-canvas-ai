import { useState } from 'react'
import type { LayoutAlignH, LayoutAlignV, LayoutBackgroundFit, LayoutBackgroundKind, LayoutMarginUnit, LayoutParams, LayoutShadowKind } from '../../../types/nodes'
import { LAYOUT_SIZE_PRESETS } from '../../../lib/layout/computeLayout'
import { Field, Num, Sel, TextField } from './controls'
import { CTRL, INPUT_STYLE, stopKeys } from './styles'

interface Props {
  params: LayoutParams
  onChange: (patch: Partial<LayoutParams>) => void
  /** バリアント名の欄を出すか（ジョブ画面では見出しに出すので省く） */
  showVariantName?: boolean
  /** 余白の実効値の注記（ノードでは切り抜きの寸法から計算して渡す） */
  marginNote?: { text: string; warn: boolean } | null
}

/** Product Layout のパラメータ入力（仕様 3-3 の表）。ProductLayoutNode と ReviewGrid のレイアウト設定で共用 */
export function LayoutParamsForm({ params, onChange, showVariantName = true, marginNote }: Props) {
  const [forceCustomSize, setForceCustomSize] = useState(false)
  const setParams = onChange
  const matchesPreset = LAYOUT_SIZE_PRESETS.some((p) => p.width === params.width && p.height === params.height)
  const presetValue = !forceCustomSize && matchesPreset ? `${params.width}x${params.height}` : 'custom'
  return (
    <div className="flex flex-col gap-2.5">
      {showVariantName && (
        <Field label="バリアント名">
          <TextField value={params.variantName} onChange={(v) => setParams({ variantName: v })} placeholder="ec_white" />
        </Field>
      )}

      <Field label="出力サイズ">
        <Sel
          value={presetValue}
          options={[...LAYOUT_SIZE_PRESETS.map((p) => [`${p.width}x${p.height}`, p.label] as [string, string]), ['custom', 'カスタム']]}
          onChange={(v) => {
            if (v === 'custom') { setForceCustomSize(true); return }
            setForceCustomSize(false)
            const p = LAYOUT_SIZE_PRESETS.find((x) => `${x.width}x${x.height}` === v)
            if (p) setParams({ width: p.width, height: p.height })
          }}
        />
        <div className="grid grid-cols-3 gap-1.5 mt-1.5">
          <Field label="幅 px"><Num value={params.width} min={16} max={8192} onChange={(v) => { if (v !== null) setParams({ width: v }) }} /></Field>
          <Field label="高さ px"><Num value={params.height} min={16} max={8192} onChange={(v) => { if (v !== null) setParams({ height: v }) }} /></Field>
          <Field label="拡大の上限 %"><Num value={params.maxScalePercent} min={100} max={400} step={10} onChange={(v) => { if (v !== null) setParams({ maxScalePercent: v }) }} title="100 = 拡大しない（既定）" /></Field>
        </div>
      </Field>

      <Field label={`余白（上・右・下・左 / ${params.marginUnit === 'percent' ? '%' : 'px'}）`}>
        <div className="grid grid-cols-5 gap-1.5">
          <Num value={params.marginTop} min={0} onChange={(v) => { if (v !== null) setParams({ marginTop: v }) }} title="上" />
          <Num value={params.marginRight} min={0} onChange={(v) => { if (v !== null) setParams({ marginRight: v }) }} title="右" />
          <Num value={params.marginBottom} min={0} onChange={(v) => { if (v !== null) setParams({ marginBottom: v }) }} title="下" />
          <Num value={params.marginLeft} min={0} onChange={(v) => { if (v !== null) setParams({ marginLeft: v }) }} title="左" />
          <Sel<LayoutMarginUnit> value={params.marginUnit} options={[['percent', '%'], ['px', 'px']]} onChange={(v) => { if (v !== null) setParams({ marginUnit: v }) }} />
        </div>
        {marginNote && (
          <div className="mt-1 text-[11px] leading-snug" style={{ color: marginNote.warn ? '#F59E0B' : 'var(--text-tertiary)' }}>{marginNote.text}</div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="水平方向">
          <Sel<LayoutAlignH> value={params.alignH} options={[['left', '左'], ['center', '中央'], ['right', '右']]} onChange={(v) => { if (v !== null) setParams({ alignH: v }) }} />
        </Field>
        <Field label="垂直方向">
          <Sel<LayoutAlignV> value={params.alignV} options={[['top', '上'], ['center', '中央'], ['bottom', '下']]} onChange={(v) => { if (v !== null) setParams({ alignV: v }) }} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="背景">
          <Sel<LayoutBackgroundKind> value={params.backgroundKind} options={[['color', '単色'], ['image', '画像（背景入力）'], ['transparent', '透過']]} onChange={(v) => { if (v !== null) setParams({ backgroundKind: v }) }} />
        </Field>
        {params.backgroundKind === 'color' && (
          <Field label="背景色">
            <div className="flex gap-1.5 items-center">
              <input type="color" className="h-8 w-9 rounded-md p-0.5 nodrag" style={INPUT_STYLE} value={params.backgroundColor} onChange={(e) => setParams({ backgroundColor: e.target.value.toUpperCase() })} />
              <input type="text" className={`${CTRL} w-full font-mono`} style={INPUT_STYLE} value={params.backgroundColor} onKeyDown={stopKeys}
                onChange={(e) => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) setParams({ backgroundColor: v.toUpperCase() }) }} />
            </div>
          </Field>
        )}
        {params.backgroundKind === 'image' && (
          <Field label="背景画像の合わせ方">
            <Sel<LayoutBackgroundFit> value={params.backgroundFit} options={[['cover', '全面を覆う'], ['contain', '全体を収める']]} onChange={(v) => { if (v !== null) setParams({ backgroundFit: v }) }} />
          </Field>
        )}
      </div>

      <Field label="影">
        <Sel<LayoutShadowKind> value={params.shadowKind} options={[['none', 'なし'], ['drop', 'ドロップシャドウ'], ['contact', '接地影']]} onChange={(v) => { if (v !== null) setParams({ shadowKind: v }) }} />
        {params.shadowKind !== 'none' && (
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            <Field label="濃さ (0〜1)"><Num value={params.shadowOpacity} min={0} max={1} step={0.05} onChange={(v) => { if (v !== null) setParams({ shadowOpacity: v }) }} /></Field>
            <Field label="ぼかし px"><Num value={params.shadowBlur} min={0} max={500} onChange={(v) => { if (v !== null) setParams({ shadowBlur: v }) }} /></Field>
            {params.shadowKind === 'drop' ? (
              <>
                <Field label="ずらし 横 px"><Num value={params.shadowOffsetX} onChange={(v) => { if (v !== null) setParams({ shadowOffsetX: v }) }} /></Field>
                <Field label="ずらし 縦 px"><Num value={params.shadowOffsetY} onChange={(v) => { if (v !== null) setParams({ shadowOffsetY: v }) }} /></Field>
              </>
            ) : (
              <>
                <Field label="幅（商品幅×）"><Num value={params.contactWidthRatio} min={0} max={5} step={0.05} onChange={(v) => { if (v !== null) setParams({ contactWidthRatio: v }) }} /></Field>
                <Field label="高さ（商品高さ×）"><Num value={params.contactHeightRatio} min={0} max={5} step={0.01} onChange={(v) => { if (v !== null) setParams({ contactHeightRatio: v }) }} /></Field>
              </>
            )}
          </div>
        )}
      </Field>
    </div>
  )
}
