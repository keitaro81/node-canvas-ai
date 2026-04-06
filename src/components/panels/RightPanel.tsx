import React from 'react'
import { useCanvasStore } from '../../stores/canvasStore'
import { NODE_ACCENT_COLORS } from '../../types/nodes'
import type { VideoGenerationNodeData, ReferenceImageNodeData } from '../../types/nodes'
import { falVideoProvider } from '../../lib/ai/provider-registry'
import type { VideoModelDefinition } from '../../lib/ai/types'

const VIDEO_MODELS = falVideoProvider.getAvailableVideoModels()

const IMAGE_MODELS = [
  { value: 'black-forest-labs/flux-schnell', label: 'FLUX Schnell' },
  { value: 'black-forest-labs/flux-dev',     label: 'FLUX Dev' },
  { value: 'black-forest-labs/flux-1.1-pro', label: 'FLUX 1.1 Pro' },
  { value: 'fal-ai/flux-2',                  label: 'FLUX.2' },
  { value: 'fal-ai/nano-banana-2',            label: 'Nano Banana 2' },
]
const IMAGE_ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'] as const

const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle', generating: 'Generating…', done: 'Done', error: 'Error',
  queued: 'Queued', processing: 'Processing…', completed: 'Completed', failed: 'Failed',
}
const STATUS_COLORS: Record<string, string> = {
  idle: 'var(--text-tertiary)', generating: '#8B5CF6', done: '#22C55E', error: '#EF4444',
  queued: '#F59E0B', processing: '#8B5CF6', completed: '#22C55E', failed: '#EF4444',
}

// ===== 共通UIパーツ =====

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">{children}</label>
}

function SelectField({ label, value, options, onChange, disabled }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none appearance-none"
        style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function ButtonGroupField({ label, value, options, onChange, disabled, accentColor = '#8B5CF6' }: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  disabled?: boolean
  accentColor?: string
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-1 flex-wrap">
        {options.map((opt) => {
          const active = value === opt
          return (
            <button
              key={opt}
              className="flex-1 py-1 rounded text-[11px] font-medium transition-colors"
              style={{
                background: active ? accentColor : 'var(--bg-elevated)',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: `1px solid ${active ? accentColor : 'var(--border)'}`,
                minWidth: '2.5rem',
              }}
              onClick={() => onChange(opt)}
              disabled={disabled}
            >
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ToggleField({ label, value, onChange, disabled, accentColor = '#8B5CF6' }: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  accentColor?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <FieldLabel>{label}</FieldLabel>
      <button
        className="relative w-8 h-4 rounded-full transition-colors"
        style={{ background: value ? accentColor : 'var(--border-active)' }}
        onClick={() => onChange(!value)}
        disabled={disabled}
      >
        <div
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
          style={{ left: value ? '18px' : '2px' }}
        />
      </button>
    </div>
  )
}

function NumberField({ label, value, onChange, placeholder, disabled }: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        className="w-full rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
        style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
        placeholder={placeholder ?? ''}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
      {children}
    </div>
  )
}

// ===== ノード別プロパティ =====

type Upd = (id: string, data: Record<string, unknown>) => void

function ImageGenProperties({ nodeId, data, updateNode }: {
  nodeId: string
  data: Record<string, unknown>
  updateNode: Upd
}) {
  const edges = useCanvasStore((s) => s.edges)

  const params = (data.params ?? {}) as Record<string, unknown>
  const model = (params.model as string) ?? 'black-forest-labs/flux-schnell'
  const aspectRatio = (params.aspectRatio as string) ?? '1:1'
  const seed = (params.seed as number | null) ?? null
  const output = data.output as string | undefined

  const imageEdges = edges.filter(
    (e) =>
      e.target === nodeId &&
      (e.targetHandle === 'in-image' ||
        e.targetHandle === 'in-image-1' ||
        e.targetHandle === 'in-image-reference' ||
        e.targetHandle === 'in-image-2')
  )
  const isOmniGen = imageEdges.length > 0

  const set = (key: string, val: unknown) =>
    updateNode(nodeId, { params: { ...params, [key]: val } })

  return (
    <>
      <section>
        <SectionTitle>Parameters</SectionTitle>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-secondary)]">Mode</span>
            <span
              className="text-[10px] rounded-full px-2 py-0.5 font-medium"
              style={isOmniGen
                ? { background: 'rgba(236,72,153,0.15)', color: '#EC4899' }
                : { background: 'rgba(99,102,241,0.15)', color: '#6366F1' }
              }
            >
              {isOmniGen ? 'NB2 Edit' : 'T2I'}
            </span>
          </div>

          {!isOmniGen && (
            <SelectField
              label="Model"
              value={model}
              options={IMAGE_MODELS}
              onChange={(v) => set('model', v)}
            />
          )}
          <div>
            <FieldLabel>Aspect Ratio</FieldLabel>
            <div className="flex gap-1 flex-wrap">
              {IMAGE_ASPECT_RATIOS.map((ratio) => {
                const active = aspectRatio === ratio
                const isAutoDisabled = ratio === 'auto' && !isOmniGen
                return (
                  <button
                    key={ratio}
                    className="flex-1 py-1 rounded text-[11px] font-medium transition-colors"
                    style={{
                      background: active ? '#8B5CF6' : 'var(--bg-elevated)',
                      color: active ? 'var(--text-primary)' : isAutoDisabled ? 'var(--border-active)' : 'var(--text-secondary)',
                      border: `1px solid ${active ? '#8B5CF6' : 'var(--border)'}`,
                      cursor: isAutoDisabled ? 'not-allowed' : 'pointer',
                      minWidth: 0,
                    }}
                    onClick={() => { if (!isAutoDisabled) set('aspectRatio', ratio) }}
                    disabled={isAutoDisabled}
                    title={ratio === 'auto' ? '参照画像のアスペクト比を自動検出' : undefined}
                  >
                    {ratio}
                  </button>
                )
              })}
            </div>
          </div>
          {!isOmniGen && (
            <NumberField
              label="Seed"
              value={seed}
              onChange={(v) => set('seed', v)}
              placeholder="空欄 = ランダム"
            />
          )}
        </div>
      </section>

      {output && (
        <section>
          <SectionTitle>Output</SectionTitle>
          <img src={output} alt="Generated" className="w-full h-auto rounded-md" style={{ border: '1px solid var(--border)' }} />
        </section>
      )}
    </>
  )
}

function VideoGenProperties({ nodeId, data, updateNode }: {
  nodeId: string
  data: VideoGenerationNodeData
  updateNode: Upd
}) {
  const edges = useCanvasStore((s) => s.edges)
  const set = (patch: Record<string, unknown>) => updateNode(nodeId, patch)
  const currentModel = VIDEO_MODELS.find((m) => m.id === data.model) ?? VIDEO_MODELS[0]

  const hasConnectedImage = edges.some((e) => e.target === nodeId && e.targetHandle === 'in-image')
  const aspectRatioOptions = (
    hasConnectedImage && (currentModel as VideoModelDefinition).i2vSupportedAspectRatios
      ? (currentModel as VideoModelDefinition).i2vSupportedAspectRatios!
      : currentModel?.supportedAspectRatios ?? []
  ) as string[]

  return (
    <>
      <section>
        <SectionTitle>Parameters</SectionTitle>
        <div className="flex flex-col gap-3">
          <SelectField
            label="Model"
            value={data.model}
            options={VIDEO_MODELS.map((m) => ({ value: m.id, label: `${m.name} ($${m.pricePerSecond}/s)` }))}
            onChange={(v) => {
              const newModel = VIDEO_MODELS.find((m) => m.id === v)
              if (!newModel) return
              const patch: Record<string, unknown> = { model: newModel.id }
              if (!newModel.supportedDurations.includes(data.duration)) patch.duration = newModel.supportedDurations[0]
              if (!newModel.supportedAspectRatios.includes(data.aspectRatio as never)) patch.aspectRatio = newModel.supportedAspectRatios[0]
              set(patch)
            }}
          />
          {currentModel && (
            <SelectField
              label={`Duration: ${data.duration}s`}
              value={data.duration}
              options={currentModel.supportedDurations.map((d) => ({ value: d, label: `${d}秒` }))}
              onChange={(v) => set({ duration: v })}
            />
          )}
          {currentModel && currentModel.supportedResolutions.length > 1 && (
            <SelectField
              label="Resolution"
              value={data.resolution}
              options={currentModel.supportedResolutions.map((r) => ({ value: r, label: r }))}
              onChange={(v) => set({ resolution: v })}
            />
          )}
          {currentModel && (
            <ButtonGroupField
              label="Aspect Ratio"
              value={data.aspectRatio}
              options={aspectRatioOptions}
              onChange={(v) => set({ aspectRatio: v })}
              accentColor="#EC4899"
            />
          )}
          {currentModel?.features.includes('audio') && (
            <ToggleField
              label="Audio"
              value={data.audioEnabled}
              onChange={(v) => set({ audioEnabled: v })}
              accentColor="#EC4899"
            />
          )}
        </div>
      </section>
      {data.videoUrl && (
        <section>
          <SectionTitle>Output URL</SectionTitle>
          <div
            className="p-2 rounded text-[11px] text-[var(--text-secondary)] font-mono break-all"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            {data.videoUrl}
          </div>
        </section>
      )}
    </>
  )
}

function ReferenceImageProperties({ data }: { data: ReferenceImageNodeData }) {
  const url = data.uploadedImagePreview || data.imageUrl
  return (
    <section>
      {url ? (
        <>
          <SectionTitle>Preview</SectionTitle>
          <img src={url} alt="Reference" className="w-full h-auto rounded-md" style={{ border: '1px solid var(--border)' }} />
        </>
      ) : (
        <span className="text-[12px] text-[var(--text-tertiary)]">画像未アップロード</span>
      )}
    </section>
  )
}

// ===== フローティングパネル =====

export function RightPanel() {
  const { nodes, selectedNodeId, updateNode } = useCanvasStore()
  const selected = nodes.find((n) => n.id === selectedNodeId)

  const upd: Upd = (id, data) => updateNode(id, data as Parameters<typeof updateNode>[1])

  const visible = !!selected

  return (
    <div
      className="pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 20,
      }}
    >
      <div
        className="pointer-events-auto flex flex-col"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 280,
          maxHeight: 'calc(100% - 24px)',
          borderRadius: 12,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateX(0)' : 'translateX(16px)',
          transition: 'opacity 150ms ease-out, transform 150ms ease-out',
          pointerEvents: visible ? 'auto' : 'none',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 flex-shrink-0"
          style={{ height: 40, borderBottom: '1px solid var(--border)' }}
        >
          {selected && (
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: NODE_ACCENT_COLORS[selected.data.type] ?? '#6B7280' }}
            />
          )}
          <span className="flex-1 text-[12px] font-semibold text-[var(--text-primary)] truncate">
            {selected?.data.label ?? 'Properties'}
          </span>
          {selected && (
            <div className="flex items-center gap-1.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: STATUS_COLORS[selected.data.status] ?? 'var(--text-tertiary)' }}
              />
              <span className="text-[10px]" style={{ color: STATUS_COLORS[selected.data.status] ?? 'var(--text-tertiary)' }}>
                {STATUS_LABELS[selected.data.status] ?? selected.data.status}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {selected && (
            <div className="p-3 flex flex-col gap-4">
              {selected.type === 'imageGenerationNode' ? (
                <ImageGenProperties
                  nodeId={selected.id}
                  data={selected.data as Record<string, unknown>}
                  updateNode={upd}
                />
              ) : selected.type === 'videoGenerationNode' ? (
                <VideoGenProperties
                  nodeId={selected.id}
                  data={selected.data as unknown as VideoGenerationNodeData}
                  updateNode={upd}
                />
              ) : selected.type === 'referenceImageNode' ? (
                <ReferenceImageProperties data={selected.data as unknown as ReferenceImageNodeData} />
              ) : (
                <>
                  {Object.keys(selected.data.params ?? {}).length > 0 && (
                    <section>
                      <SectionTitle>Parameters</SectionTitle>
                      <div className="flex flex-col gap-2">
                        {Object.entries(selected.data.params ?? {}).map(([key, value]) => (
                          <ParamField
                            key={key}
                            paramKey={key}
                            value={value}
                            onChange={(newVal) =>
                              updateNode(selected.id, {
                                params: { ...selected.data.params, [key]: newVal },
                              })
                            }
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {selected.data.output !== undefined && (
                    <section>
                      <SectionTitle>Output</SectionTitle>
                      <div
                        className="p-2 rounded text-[11px] text-[var(--text-secondary)] font-mono break-all"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                      >
                        {typeof selected.data.output === 'string'
                          ? selected.data.output
                          : JSON.stringify(selected.data.output, null, 2)}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface ParamFieldProps {
  paramKey: string
  value: unknown
  onChange: (val: unknown) => void
}

function ParamField({ paramKey, value, onChange }: ParamFieldProps) {
  const label = paramKey.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())

  if (paramKey === 'prompt' || paramKey === 'negativePrompt') {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-[var(--text-secondary)]">{label}</label>
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] rounded outline-none resize-y"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', minHeight: 80 }}
        />
      </div>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <label className="text-[12px] text-[var(--text-secondary)]">{label}</label>
        <button
          onClick={() => onChange(!value)}
          className="w-8 h-4 rounded-full relative transition-colors duration-150"
          style={{ background: value ? '#8B5CF6' : 'var(--border)' }}
        >
          <div
            className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-150"
            style={{ left: value ? '18px' : '2px' }}
          />
        </button>
      </div>
    )
  }

  if (typeof value === 'number') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex justify-between">
          <label className="text-[12px] text-[var(--text-secondary)]">{label}</label>
          <span className="text-[12px] text-[var(--text-primary)]">{value}</span>
        </div>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] rounded outline-none"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
        />
      </div>
    )
  }

  if (typeof value === 'string' && value.length > 60) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-[var(--text-secondary)]">{label}</label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] rounded outline-none resize-y"
          style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)', minHeight: 80 }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] text-[var(--text-secondary)]">{label}</label>
      <input
        type="text"
        value={typeof value === 'string' ? value : String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] rounded outline-none"
        style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}
      />
    </div>
  )
}
