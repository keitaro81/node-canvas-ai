// 一括 App の「設定」（2026-11-02 メモ 46・使う人ごとに選ぶ）: App 化したグループの中で処理に使うモデル・画像・文と、
// 処理するノードの「表示」にした欄（メモ 67: Image Generation のプロンプト・モデル・比率・解像度、Video Generation のモデル・長さなど）を、使う人がここで選び直す。
// 変えた内容はこのブラウザに覚え、処理を始めるときにワークフローの写しへ入れる（キャンバスのワークフローは変えない・lib/apps/appSettings.ts）
import { useState, type ReactNode } from 'react'
import { ArrowCounterClockwise, ImageSquare, SlidersHorizontal, UserCircle } from '@phosphor-icons/react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useSignedMedia } from '../../hooks/useSignedMedia'
import { ModelPickerDialog } from '../library/ModelPickerDialog'
import { MediaPickerDialog } from '../library/MediaPickerDialog'
import { libraryCanonicalUrl } from '../../lib/api/library'
import { MODEL_ROLES } from '../../lib/library/modelRoles'
import { CUT_ROLE_LABEL } from '../../lib/video/productVideo'
import { cutSetRoleHandle } from '../../lib/batch/plan'
import { missingModelRoles, nextNodeOverride, withNodeOverride, type AppSetting, type AppSettingField, type ModelCuts } from '../../lib/apps/appSettings'
import { FieldRenderer } from '../capsule/CapsuleView'

const ACCENT = '#14B8A6'

interface RowProps { field: AppSettingField; setting: AppSetting | undefined; onSet: (s: AppSetting) => void; onReset: () => void; workflowId: string | null }

function SettingCard({ field, overridden, onReset, children }: { field: AppSettingField; overridden: boolean; onReset: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg p-2 flex flex-col gap-1.5" style={{ border: `1px solid ${overridden ? `${ACCENT}88` : 'var(--border)'}`, background: 'var(--bg-canvas)' }}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{field.label}</span>
        {overridden && <span className="shrink-0 text-[10px] px-1.5 rounded" style={{ color: ACCENT, background: `${ACCENT}1F` }}>この画面で変更</span>}
        <div className="flex-1" />
        {overridden && (
          <button type="button" onClick={onReset} className="shrink-0 flex items-center gap-1 h-6 px-1.5 rounded text-[11px] hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-secondary)' }} title="キャンバスのノードの値に戻す">
            <ArrowCounterClockwise size={12} />元に戻す
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function Thumb({ url, onError, icon }: { url: string | null | undefined; onError: () => void; icon: ReactNode }) {
  return (
    <div className="shrink-0 rounded overflow-hidden flex items-center justify-center" style={{ width: 44, height: 56, background: 'var(--bg-placeholder)', color: 'var(--text-tertiary)' }}>
      {url ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} onError={onError} /> : icon}
    </div>
  )
}

function ChangeButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 h-7 px-2.5 rounded-md text-[11px] font-medium hover:bg-[var(--bg-elevated)]" style={{ color: ACCENT, border: `1px solid ${ACCENT}55` }} title={title}>変える</button>
  )
}

function ModelRow({ field, setting, onSet, onReset }: RowProps) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === field.nodeId))
  const d = (node?.data ?? {}) as unknown as { modelName?: string | null; cuts?: ModelCuts; outputs?: Record<string, string> }
  const overridden = setting?.kind === 'model'
  const cuts: ModelCuts = (overridden ? setting.cuts : d.cuts) ?? {}
  const name = overridden ? setting.modelName : d.modelName
  const thumbRole = field.roles.find((r) => cuts[r]?.url) ?? 'front'
  // モデルのカットはライブラリの素材（ワークフローの署名には入らない）ので、素材ごとに署名する。キャンバスの値は Model ノードが署名済みの出力を先に使う
  const raw = overridden ? cuts[thumbRole]?.url : (d.outputs?.[cutSetRoleHandle(thumbRole)] ?? cuts[thumbRole]?.url)
  const { url, onError } = useSignedMedia(raw ?? null, null)
  const missing = missingModelRoles(field, cuts)
  const [open, setOpen] = useState(false)
  return (
    <SettingCard field={field} overridden={overridden} onReset={onReset}>
      <div className="flex items-center gap-2">
        <Thumb url={url} onError={onError} icon={<UserCircle size={20} />} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] truncate" style={{ color: name ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{name || 'モデルが選ばれていません'}</div>
          {field.roles.length > 0 && <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>使う向き: {field.roles.map((r) => CUT_ROLE_LABEL[r]).join('・')}</div>}
        </div>
        <ChangeButton onClick={() => setOpen(true)} title="ライブラリのモデルから選ぶ" />
      </div>
      {missing.length > 0 && (
        <div className="rounded px-2 py-1 text-[11px] leading-snug" style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.12)' }}>
          このモデルには「{missing.map((r) => CUT_ROLE_LABEL[r]).join('・')}」の写真がありません。その向きを使う処理は行われません
        </div>
      )}
      <ModelPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        onPick={(model, items) => {
          const byId = new Map(items.map((it) => [it.id, it]))
          const next: ModelCuts = {}
          for (const r of MODEL_ROLES) { const itemId = model.cuts[r.id]; const it = itemId ? byId.get(itemId) : undefined; if (it) next[r.id] = { itemId: it.id, url: libraryCanonicalUrl(it) } }
          onSet({ kind: 'model', modelId: model.id, modelName: model.name, cuts: next })
        }}
      />
    </SettingCard>
  )
}

function ImageRow({ field, setting, onSet, onReset, workflowId }: RowProps) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === field.nodeId))
  const d = (node?.data ?? {}) as Record<string, unknown>
  const overridden = setting?.kind === 'image'
  const raw = overridden ? setting.url : ((d.uploadedImagePreview as string | null | undefined) || (d.imageUrl as string | null | undefined) || null)
  const { url, onError } = useSignedMedia(raw, overridden ? null : workflowId)
  const [open, setOpen] = useState(false)
  return (
    <SettingCard field={field} overridden={overridden} onReset={onReset}>
      <div className="flex items-center gap-2">
        <Thumb url={url} onError={onError} icon={<ImageSquare size={20} />} />
        <div className="flex-1 min-w-0 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{raw ? (overridden ? 'この画面で選んだ画像' : 'キャンバスの画像') : '画像がありません'}</div>
        <ChangeButton onClick={() => setOpen(true)} title="画像を選ぶ（アップロード / ライブラリ）" />
      </div>
      <MediaPickerDialog open={open} onClose={() => setOpen(false)} media="image" source="capsule" onPick={(items) => { const p = items[0]; if (p) onSet({ kind: 'image', url: p.url }) }} />
    </SettingCard>
  )
}

function TextRow({ field, setting, onSet, onReset }: RowProps) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === field.nodeId))
  const nodePrompt = String(((node?.data as unknown as { params?: { prompt?: unknown } } | undefined)?.params?.prompt) ?? '')
  const overridden = setting?.kind === 'text'
  const value = overridden ? setting.prompt : nodePrompt
  return (
    <SettingCard field={field} overridden={overridden} onReset={onReset}>
      <textarea
        className="w-full rounded-md px-2.5 py-2 text-[12px] focus:outline-none resize-y"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', minHeight: 64 }}
        value={value}
        onChange={(e) => { const v = e.target.value; if (v === nodePrompt) onReset(); else onSet({ kind: 'text', prompt: v }) }}
      />
      {overridden && !setting.prompt.trim() && <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>空のときはキャンバスの文で処理します</div>}
    </SettingCard>
  )
}

/** 処理するノードの「表示」の欄（生成 App と同じ欄の部品）。値はキャンバスのノードに上書きを重ねたもの、変えると上書きだけが変わる */
function NodeRow({ field, setting, onSet, onReset }: RowProps) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === field.nodeId))
  if (!node) return null
  const base = node.data as unknown as Record<string, unknown>
  const ov = setting?.kind === 'node' ? setting : null
  const data = withNodeOverride(base, ov, { display: true })
  const update = (patch: Record<string, unknown>) => {
    const next = nextNodeOverride(base, ov, patch)
    if (next) onSet({ kind: 'node', ...next })
    else onReset()
  }
  const emptyPrompt = !!ov && typeof ov.params.prompt === 'string' && !ov.params.prompt.trim()
  return (
    <SettingCard field={field} overridden={!!ov} onReset={onReset}>
      <div className="flex flex-col -mb-3">
        {(field.fields ?? []).map((f) => <FieldRenderer key={f.id} nodeId={field.nodeId} field={f} source={{ data, update }} />)}
      </div>
      {emptyPrompt && <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>プロンプトが空のときはキャンバスの文で処理します</div>}
    </SettingCard>
  )
}

/** 設定欄。fields が空なら出さない */
export function AppSettingsPanel({ fields, settings, onChange, workflowId }: { fields: AppSettingField[]; settings: Record<string, AppSetting>; onChange: (next: Record<string, AppSetting>) => void; workflowId: string | null }) {
  if (!fields.length) return null
  const set = (id: string, s: AppSetting) => onChange({ ...settings, [id]: s })
  const reset = (id: string) => { const next = { ...settings }; delete next[id]; onChange(next) }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal size={14} style={{ color: ACCENT }} />
        <div className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>設定</div>
      </div>
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
        この App の処理で使うモデル・画像・文と、処理の設定です。ここで変えた内容はこのブラウザに覚えて次の処理から使い、キャンバスのワークフローは変わりません（何を使ったかは履歴に残ります）。
      </p>
      {fields.map((f) => {
        const props: RowProps = { field: f, setting: settings[f.nodeId], onSet: (s) => set(f.nodeId, s), onReset: () => reset(f.nodeId), workflowId }
        return f.kind === 'model' ? <ModelRow key={f.nodeId} {...props} /> : f.kind === 'image' ? <ImageRow key={f.nodeId} {...props} /> : f.kind === 'node' ? <NodeRow key={f.nodeId} {...props} /> : <TextRow key={f.nodeId} {...props} />
      })}
    </div>
  )
}
