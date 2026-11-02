// 一括 App の「設定」（2026-11-02 メモ 46 → 決定「使う人ごとに選ぶ」）: App 化したグループの中で処理に使う固定の入力
// （Model ノード = モデル・Reference Image = 画像・Text Prompt = 文）と、処理するノード（Image Generation / Video Generation）の
// 「表示」にした欄（メモ 67: プロンプト・モデル・比率・解像度など。生成 App と同じ欄）を、使う人が App の画面で選び直す。
// 選んだ内容はブラウザに覚え（ワークフロー × 入口ごと）、処理を始めるときにワークフローの写しへ入れる。
// キャンバスのワークフローは変えない（何を使ったかはジョブの写しに残る）。既定はキャンバスのノードの値
import { isModelRole } from '../library/modelRoles'
import type { CutRole } from '../video/productVideo'
import type { CapsuleFieldDef } from '../../types/nodes'

export type AppSettingKind = 'model' | 'image' | 'text' | 'node'
export type ModelCuts = Partial<Record<CutRole, { itemId: string; url: string }>>
/** 処理するノードの欄の上書き。top = ノードの data の直下（Video Generation のモデル・長さなど）、params = data.params（Image Generation） */
export type NodeOverride = { top: Record<string, string | boolean>; params: Record<string, string> }
export type AppSetting =
  | { kind: 'model'; modelId: string; modelName: string | null; cuts: ModelCuts }
  | { kind: 'image'; url: string }
  | { kind: 'text'; prompt: string }
  | ({ kind: 'node' } & NodeOverride)
export type AppSettings = Record<string, AppSetting>

/** 設定欄の 1 行。roles = Model ノードからつないだ向き（そのカットを処理に使う）。fields = 処理するノードの「表示」の欄（kind: 'node'） */
export interface AppSettingField { nodeId: string; kind: AppSettingKind; label: string; roles: CutRole[]; fields?: CapsuleFieldDef[] }

// 処理するノードのうち、一括 App の「設定」に出せる欄（生成 App と同じ「表示」の欄のうち、一括の処理に効くもの）
const NODE_FIELD_IDS: Record<string, string[]> = {
  imageGenerationNode: ['prompt', 'editModel', 'model', 'aspectRatio', 'resolution'],
  videoGenerationNode: ['model', 'duration', 'resolution', 'aspectRatio', 'audioEnabled'],
}
// 上書きできる値（ほかの値は覚えない・写しに入れない）
const NODE_TOP_KEYS = new Set(['model', 'duration', 'resolution', 'aspectRatio', 'audioEnabled'])
const NODE_PARAM_KEYS = new Set(['prompt', 'editModel', 'model', 'aspectRatio', 'resolution', 'recraftImageSize', 'gptImageSize'])
const DEFAULT_NODE_LABEL: Record<string, string> = { imageGenerationNode: 'Image Generation', videoGenerationNode: 'Video Generation' }

interface NodeLike { id: string; type?: string; position?: { x: number; y: number }; data?: unknown }
interface EdgeLike { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

const KIND_OF_TYPE: Record<string, Exclude<AppSettingKind, 'node'>> = { libraryModelNode: 'model', referenceImageNode: 'image', textPromptNode: 'text' }
const KIND_ORDER: AppSettingKind[] = ['model', 'image', 'text', 'node']   // 文（Text Prompt）→ ノードのプロンプトの欄 = 使う順
const DEFAULT_LABEL: Record<Exclude<AppSettingKind, 'node'>, string> = { model: 'Model', image: 'Reference Image', text: 'Text Prompt' }
// 生成 App と同じ「表示」の欄（capsuleFields）。外した欄は App に出さない（Model ノードには「表示」が無いので常に出す）
const VISIBILITY_FIELD: Partial<Record<AppSettingKind, string>> = { image: 'imageUrl', text: 'prompt' }

function hiddenInApp(d: Record<string, unknown>, kind: AppSettingKind): boolean {
  const f = VISIBILITY_FIELD[kind]
  if (!f) return false
  const fields = (d.capsuleFields ?? {}) as Record<string, { capsuleVisibility?: string } | undefined>
  return fields[f]?.capsuleVisibility === 'hidden'
}
const roleOfHandle = (h: string | null | undefined): CutRole | null => {
  const r = h?.startsWith('out-image-') ? h.slice('out-image-'.length) : null
  return isModelRole(r) ? r : null
}

/** 設定欄に出す固定の入力: 処理（計画したタスク）のノードへ直接つながる Model / Reference Image / Text Prompt。モデル → 画像 → 文の順、同じ種類は上から。
 *  一括処理で使われない入力は出さない（Image Generation の画像入力は最初の 1 つだけ使う・lib/batch/plan.ts と同じ） */
export function appSettingFieldsOf(nodes: NodeLike[], edges: EdgeLike[], taskNodeIds: Iterable<string>): AppSettingField[] {
  const tasks = new Set(taskNodeIds)
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]))
  const isImageIn = (e: EdgeLike) => (e.targetHandle ?? '').startsWith('in-image')
  const usedByTask = (e: EdgeLike): boolean => {
    if (!tasks.has(e.target)) return false
    if (typeOf.get(e.target) === 'imageGenerationNode' && isImageIn(e)) return edges.find((x) => x.target === e.target && isImageIn(x)) === e
    return true
  }
  const out: Array<AppSettingField & { y: number; x: number }> = []
  for (const n of nodes) {
    // 処理するノードの「表示」の欄（メモ 67）
    const ids = NODE_FIELD_IDS[n.type ?? '']
    if (ids && tasks.has(n.id)) {
      const d = (n.data ?? {}) as Record<string, unknown>
      const fields = Object.values((d.capsuleFields ?? {}) as Record<string, CapsuleFieldDef>)
        .filter((f) => f && ids.includes(f.id) && f.capsuleVisibility !== 'hidden')
        .sort((a, b) => (a.capsuleOrder ?? 99) - (b.capsuleOrder ?? 99))
      if (fields.length) {
        const label = typeof d.label === 'string' && d.label.trim() ? d.label.trim() : DEFAULT_NODE_LABEL[n.type ?? ''] ?? 'ノード'
        out.push({ nodeId: n.id, kind: 'node', label, roles: [], fields, y: n.position?.y ?? 0, x: n.position?.x ?? 0 })
      }
      continue
    }
    const kind = KIND_OF_TYPE[n.type ?? '']
    if (!kind) continue
    const used = edges.filter((e) => e.source === n.id && usedByTask(e))
    if (!used.length) continue
    const d = (n.data ?? {}) as Record<string, unknown>
    if (hiddenInApp(d, kind)) continue
    const roles = kind === 'model' ? [...new Set(used.map((e) => roleOfHandle(e.sourceHandle)).filter((r): r is CutRole => !!r))] : []
    const label = typeof d.label === 'string' && d.label.trim() ? d.label.trim() : DEFAULT_LABEL[kind]
    out.push({ nodeId: n.id, kind, label, roles, y: n.position?.y ?? 0, x: n.position?.x ?? 0 })
  }
  return out
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.y - b.y || a.x - b.x)
    .map(({ nodeId, kind, label, roles, fields }) => (fields ? { nodeId, kind, label, roles, fields } : { nodeId, kind, label, roles }))
}

/** 処理するノードの欄を変えたときの上書き（キャンバスの値と同じになったものは外す）。patch はノードに書くときと同じ形（params はまるごと渡ってくる） */
export function nextNodeOverride(base: Record<string, unknown>, current: NodeOverride | null, patch: Record<string, unknown>): NodeOverride | null {
  const top: Record<string, string | boolean> = { ...(current?.top ?? {}) }
  const params: Record<string, string> = { ...(current?.params ?? {}) }
  const baseParams = (base.params ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'params' && v && typeof v === 'object') {
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        if (!NODE_PARAM_KEYS.has(pk) || typeof pv !== 'string') continue
        if (pv === (baseParams[pk] ?? '')) delete params[pk]
        else params[pk] = pv
      }
    } else if (NODE_TOP_KEYS.has(k) && (typeof v === 'string' || typeof v === 'boolean')) {
      if (v === base[k]) delete top[k]
      else top[k] = v
    }
  }
  return Object.keys(top).length || Object.keys(params).length ? { top, params } : null
}

/** ノードの data に上書きを重ねる（App の欄の表示と、写しに入れるとき）。写しでは空のプロンプトはキャンバスの文のまま（表示は空のまま見せる） */
export function withNodeOverride(data: Record<string, unknown>, ov: NodeOverride | null | undefined, opts: { display?: boolean } = {}): Record<string, unknown> {
  if (!ov) return data
  const params = { ...((data.params as Record<string, unknown> | undefined) ?? {}) }
  for (const [k, v] of Object.entries(ov.params)) { if (k === 'prompt' && !v.trim() && !opts.display) continue; params[k] = v }
  return { ...data, ...ov.top, params }
}

/** 写しに入れる: 使う人が選んだ値をノードの data に重ねる。設定欄に出ている入力で、種類が合うものだけ。空の文はキャンバスの文のまま */
export function applyAppSettings<N extends NodeLike>(nodes: N[], settings: AppSettings, fields: AppSettingField[]): N[] {
  const allowed = new Map(fields.map((f) => [f.nodeId, f.kind]))
  return nodes.map((n) => {
    const s = settings[n.id]
    if (!s || allowed.get(n.id) !== s.kind) return n
    const d = (n.data ?? {}) as Record<string, unknown>
    if (s.kind === 'model') return { ...n, data: { ...d, modelId: s.modelId, modelName: s.modelName, cuts: s.cuts, outputs: {} } }
    if (s.kind === 'image') return { ...n, data: { ...d, imageUrl: s.url, output: s.url, uploadedImagePreview: null } }
    if (s.kind === 'node') return { ...n, data: withNodeOverride(d, s) }
    if (!s.prompt.trim()) return n
    return { ...n, data: { ...d, params: { ...((d.params as Record<string, unknown> | undefined) ?? {}), prompt: s.prompt } } }
  })
}

/** 選んだモデルに、つないだ向きのカットが無い（その向きを使う処理は行われない） */
export const missingModelRoles = (field: AppSettingField, cuts: ModelCuts | null | undefined): CutRole[] => field.roles.filter((r) => !cuts?.[r]?.url)

/** ブラウザに覚えるときのキー（ワークフロー × 入口ごと） */
export const appSettingsStorageKey = (workflowId: string | null | undefined, entryId: string | null | undefined): string => `app-settings:${workflowId ?? 'draft'}:${entryId ?? ''}`

/** 覚えていた値を読む（形が合わないものは捨てる） */
export function parseAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return {}
  const out: AppSettings = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = v as Record<string, unknown> | null
    if (!s || typeof s !== 'object') continue
    if (s.kind === 'model' && typeof s.modelId === 'string' && s.cuts && typeof s.cuts === 'object') {
      const cuts: ModelCuts = {}
      for (const [role, c] of Object.entries(s.cuts as Record<string, unknown>)) {
        const cut = c as { itemId?: unknown; url?: unknown } | null
        if (isModelRole(role) && cut && typeof cut.url === 'string' && cut.url) cuts[role] = { itemId: typeof cut.itemId === 'string' ? cut.itemId : '', url: cut.url }
      }
      out[id] = { kind: 'model', modelId: s.modelId, modelName: typeof s.modelName === 'string' ? s.modelName : null, cuts }
    } else if (s.kind === 'image' && typeof s.url === 'string' && s.url) out[id] = { kind: 'image', url: s.url }
    else if (s.kind === 'text' && typeof s.prompt === 'string') out[id] = { kind: 'text', prompt: s.prompt.slice(0, 4000) }
    else if (s.kind === 'node') {
      const top: Record<string, string | boolean> = {}
      const params: Record<string, string> = {}
      for (const [k, v] of Object.entries((s.top ?? {}) as Record<string, unknown>)) if (NODE_TOP_KEYS.has(k) && (typeof v === 'string' || typeof v === 'boolean')) top[k] = v
      for (const [k, v] of Object.entries((s.params ?? {}) as Record<string, unknown>)) if (NODE_PARAM_KEYS.has(k) && typeof v === 'string') params[k] = v.slice(0, 4000)
      if (Object.keys(top).length || Object.keys(params).length) out[id] = { kind: 'node', top, params }
    }
  }
  return out
}
