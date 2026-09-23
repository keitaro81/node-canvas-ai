import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, CircleNotch, Warning } from '@phosphor-icons/react'
import type { ExportFormat, ExportParams, ExportZipFolders } from '../../../types/nodes'
import { EXT_OF, applyNamePattern, folderFor, normalizeExportParams } from '../../../lib/export/naming'
import type { ExportOutcome, ExportProgress } from '../../../lib/review/exportJob'
import { ZIP_WARN_BYTES } from '../../../lib/review/exportJob'
import { Field, Num, Sel, TextField } from '../../nodes/pp/controls'

export interface ExportDialogState {
  phase: 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  progress?: ExportProgress
  result?: ExportOutcome
  error?: string
}

interface Props {
  open: boolean
  scope: 'ok' | 'all'
  initialParams: ExportParams
  targetCount: number
  variantNames: string[]
  sampleSku: string | null
  estimateBytes: number
  state: ExportDialogState
  onStart: (params: ExportParams) => void
  onCancel: () => void
  onClose: () => void
}

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${Math.round(b / 1024 / 1024)} MB`)

/** OK のみ / すべて書き出し（仕様 5 章・3-4）。フル解像度で描画して形式変換し、ZIP にまとめる */
export function ExportDialog(props: Props) {
  if (!props.open) return null
  return <ExportDialogInner {...props} />
}

function ExportDialogInner({ scope, initialParams, targetCount, variantNames, sampleSku, estimateBytes, state, onStart, onCancel, onClose }: Props) {
  const [params, setParams] = useState<ExportParams>(() => normalizeExportParams(initialParams))   // 開くたびにマウント
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && state.phase !== 'running') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [state.phase, onClose])
  const preview = useMemo(() => {
    const v = variantNames[0] ?? 'variant'
    const base = applyNamePattern(params.namePattern, { sku: sampleSku ?? 'SKU', original: 'original', index: 1, variant: v, now: new Date() })
    return `${folderFor(params.zipFolders, v, sampleSku ?? 'SKU')}${base}.${EXT_OF[params.format]}`
  }, [params, variantNames, sampleSku])
  const running = state.phase === 'running'
  const total = targetCount * variantNames.length
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div role="dialog" aria-modal="true" className="w-[480px] max-w-[92vw] rounded-xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{scope === 'ok' ? 'OK のみ書き出し' : 'すべて書き出し'}</h2>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
          対象 {targetCount} 枚 × {variantNames.length} バリアント = {total} ファイル。フル解像度で描画して ZIP にまとめます（概算 {mb(estimateBytes)}）。
        </p>
        {estimateBytes > ZIP_WARN_BYTES && state.phase === 'idle' && (
          <div className="mt-2 rounded-lg px-3 py-2 text-[11px] flex items-start gap-1" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: '#F59E0B' }}>
            <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />ZIP が 1GB を超える見込みです。OK のみに絞るか、バリアントを分けて書き出すことをおすすめします。
          </div>
        )}

        {state.phase === 'idle' && (
          <div className="mt-3 flex flex-col gap-2.5">
            <Field label="ファイル名の規則（{sku} {original} {variant} {index} {index:02} {date}）">
              <TextField value={params.namePattern} onChange={(v) => setParams((p) => ({ ...p, namePattern: v }))} mono />
              <div className="text-[11px] mt-1 font-mono truncate" style={{ color: 'var(--text-tertiary)' }} title={preview}>例: {preview}</div>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="形式"><Sel<ExportFormat> value={params.format} options={[['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']]} onChange={(v) => setParams((p) => ({ ...p, format: v }))} /></Field>
              <Field label="品質（JPEG / WebP）"><Num value={params.jpegQuality} min={70} max={100} onChange={(v) => { if (v !== null) setParams((p) => ({ ...p, jpegQuality: v })) }} /></Field>
              <Field label="最大 KB（任意）"><Num value={params.maxFileKb} min={50} max={100000} onChange={(v) => setParams((p) => ({ ...p, maxFileKb: v }))} placeholder="指定なし" /></Field>
            </div>
            <Field label="ZIP 内のフォルダ分け"><Sel<ExportZipFolders> value={params.zipFolders} options={[['variant', 'バリアント別'], ['sku', 'SKU 別'], ['none', 'なし']]} onChange={(v) => setParams((p) => ({ ...p, zipFolders: v }))} /></Field>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={onClose} className="px-3 h-8 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>キャンセル</button>
              <button onClick={() => onStart(normalizeExportParams({ ...params, zip: true }))} disabled={total === 0} className="px-4 h-8 rounded-lg text-[12px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>書き出す</button>
            </div>
          </div>
        )}

        {running && (
          <div className="mt-4">
            <div className="h-1.5 rounded overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
              <div className="h-full transition-all" style={{ width: `${total ? ((state.progress?.done ?? 0) / total) * 100 : 0}%`, background: 'var(--accent)' }} />
            </div>
            <div className="flex items-center gap-2 mt-2 text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
              <CircleNotch size={14} className="animate-spin shrink-0" />{state.progress?.done ?? 0} / {total}・{state.progress?.message ?? '準備中…'}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={onCancel} className="px-3 h-8 rounded-lg text-[12px] hover:bg-[var(--bg-elevated)]" style={{ border: '1px solid var(--border-active)', color: 'var(--text-primary)' }}>中止</button>
            </div>
          </div>
        )}

        {(state.phase === 'done' || state.phase === 'cancelled' || state.phase === 'error') && (
          <div className="mt-4">
            {state.phase === 'done' && state.result && (
              <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: '#22C55E' }}><CheckCircle size={18} weight="fill" />{state.result.name} をダウンロードしました（{state.result.files} ファイル・{mb(state.result.bytes)}）</div>
            )}
            {state.phase === 'cancelled' && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>中止しました。</div>}
            {state.phase === 'error' && <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444' }}>{state.error}</div>}
            {!!state.result?.warnings.length && (
              <div className="mt-2 max-h-40 overflow-auto rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: '#F59E0B' }}>
                {state.result.warnings.slice(0, 50).map((w, i) => <div key={i}>{w}</div>)}
                {state.result.warnings.length > 50 && <div>…他 {state.result.warnings.length - 50} 件</div>}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="px-4 h-8 rounded-lg text-[12px] font-medium text-white" style={{ background: 'var(--accent)' }}>閉じる</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
