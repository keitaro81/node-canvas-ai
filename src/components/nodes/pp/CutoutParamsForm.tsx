import type { CutoutEngine, CutoutParams } from '../../../types/nodes'
import { BIREFNET_MODELS, BIREFNET_RESOLUTIONS, CUTOUT_ENGINES, CUTOUT_ENGINE_IDS } from '../../../lib/cutout/engines'
import { Field, Range } from './controls'
import { CTRL, INPUT_STYLE } from './styles'

interface Props {
  params: CutoutParams
  onChange: (patch: Partial<CutoutParams>) => void
  disabled?: boolean
}

/** 背景切り抜きの設定（エンジン・モデル・動作解像度・しきい値・ぼかし）。RemoveBackgroundNode と「NG のみ再実行」で共用 */
export function CutoutParamsForm({ params, onChange, disabled }: Props) {
  const engineDef = CUTOUT_ENGINES[params.engine]
  return (
    <div className="flex flex-col gap-2.5">
      <Field label="エンジン">
        <select className={`${CTRL} w-full`} style={INPUT_STYLE} value={params.engine} disabled={disabled} onChange={(e) => onChange({ engine: e.target.value as CutoutEngine })}>
          {CUTOUT_ENGINE_IDS.map((k) => <option key={k} value={k}>{CUTOUT_ENGINES[k].label}</option>)}
        </select>
        <div className="text-[11px] text-[var(--text-tertiary)] mt-1 leading-snug">{engineDef.pricing}・{engineDef.note}</div>
      </Field>
      {params.engine === 'birefnet' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="モデルバリアント">
            <select className={`${CTRL} w-full`} style={INPUT_STYLE} value={params.birefnetModel} disabled={disabled} onChange={(e) => onChange({ birefnetModel: e.target.value })}>
              {BIREFNET_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="動作解像度">
            <select className={`${CTRL} w-full`} style={INPUT_STYLE} value={params.birefnetResolution} disabled={disabled} onChange={(e) => onChange({ birefnetResolution: e.target.value })}>
              {BIREFNET_RESOLUTIONS.map((r) => (
                <option key={r} value={r} disabled={r === '2304x2304' && params.birefnetModel !== 'General Use (Dynamic)'}>{r}{r === '2304x2304' ? '（Dynamic のみ）' : ''}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <Range label="アルファのしきい値" value={params.alphaThreshold} min={0} max={255} disabled={disabled} onChange={(v) => onChange({ alphaThreshold: v })} />
      <Range label="縁のぼかし幅" value={params.featherPx} min={0} max={20} unit="px" disabled={disabled} onChange={(v) => onChange({ featherPx: v })} />
    </div>
  )
}
