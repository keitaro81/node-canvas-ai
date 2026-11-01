// ノードが組み済みのテンプレート（2026-10-31・設計 docs/specs/product-video-nodes.md §8、2026-11-01 試着 docs/specs/library-tryon.md §4.2）。
// My Projects の「テンプレートから作成」で新しいワークフローにする。
// - 商品動画の 3 構成（EC 標準 15 秒 / ターンテーブル 12 秒 / ショート 9 秒）は、旧 Product Video ノードの展開と同じ関数で
//   Cut Set Input → Video Generation × ショット → Video Merge → Export に組む（旧ノードのプリセットの置き場がここになる）
// - 試着（2b-4）: 服のカット（SKU ごと）→ Try-On × 向き → ターンテーブルの動画、商品写真 → Try-On → 着用画像の書き出し
import { CUT_ROLE_LABEL, DEFAULT_BASE_PROMPT, DEFAULT_NEGATIVE_PROMPT, VIDEO_TEMPLATES, templateById, totalSeconds, type CutRole } from '../video/productVideo'
import { CUT_SET_ITEM_HANDLE, PRODUCT_VIDEO_DEFAULT_MODEL, VIDEO_GEN_END_HANDLE, VIDEO_GEN_START_HANDLE, VIDEO_OUTPUT_HANDLE, cutSetRoleHandle, expandProductVideoNode, videoMergeSlotHandle, type SnapshotEdge, type SnapshotNode } from '../batch/plan'
import { DEFAULT_EXPORT_PARAMS } from '../export/naming'
import { DEFAULT_BATCH_INPUT_PARAMS } from '../batch/items'
import { DEFAULT_TRY_ON_PARAMS, TRY_ON_GARMENT_HANDLE, TRY_ON_OUTPUT_HANDLE } from '../tryon/prompt'
import { DEFAULT_CUTOUT_PARAMS } from '../cutout/engines'
import { DEFAULT_LAYOUT_PARAMS } from '../layout/computeLayout'
import { PRODUCT_LAYOUT_INPUT_CUTOUT, PRODUCT_LAYOUT_OUTPUT } from '../layout/nodeIo'
import { REMOVE_BACKGROUND_INPUT } from '../batch/plan'
import { REMOVE_BACKGROUND_OUTPUT_HANDLE } from '../cutout/upstream'

export interface TemplateCanvas { nodes: SnapshotNode[]; edges: SnapshotEdge[]; viewport: null }
/** 目的（一覧のグループ）: 商品写真を整える / モデルに着せる / 商品動画を作る */
export type TemplateGoal = 'photo' | 'tryon' | 'video'
export const TEMPLATE_GOALS: Array<{ id: TemplateGoal; label: string }> = [{ id: 'photo', label: '商品写真を整える' }, { id: 'tryon', label: 'モデルに着せる（着用画像）' }, { id: 'video', label: '商品動画を作る' }]
export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  kind: 'video' | 'image'
  goal: TemplateGoal
  shots: number
  seconds: number
  summary: string        // 一覧の 3 行目（構成と、作った後にすること）
  build: () => TemplateCanvas
}

const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): SnapshotEdge => ({ id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle })
const shotIndexOf = (id: string): number | null => { const m = /^pv:shot:(\d+)$/.exec(id); return m ? Number(m[1]) : null }
const renameId = (id: string): string => {
  if (id === 'pv:cuts') return 'cut-set'
  if (id === 'pv:base') return 'base-prompt'
  if (id === 'pv') return 'merge'
  const i = shotIndexOf(id)
  return i === null ? id : `shot-${i + 1}`
}

/** 商品動画のテンプレート（VIDEO_TEMPLATES の id）からキャンバスを組む。id は読みやすい固定名（cut-set / base-prompt / shot-N / merge / export） */
export function buildProductVideoTemplate(templateId: string): TemplateCanvas {
  const tpl = templateById(templateId)
  if (!tpl) throw new Error(`unknown template: ${templateId}`)
  const x = 80, y = 80
  const ex = expandProductVideoNode({ id: 'pv', type: 'productVideoNode', position: { x, y }, data: { type: 'productVideo', label: '商品動画', params: { templateId }, status: 'idle' } })
  const nodes: SnapshotNode[] = ex.nodes.map((n) => {
    const i = shotIndexOf(n.id)
    const label = i !== null ? String(n.data?.label ?? '').replace(/^商品動画 /, 'ショット ') : n.id === 'pv' ? 'Video Merge' : n.data?.label
    return { ...n, id: renameId(n.id), data: { ...n.data, label } }
  })
  const edges: SnapshotEdge[] = ex.edges.map((e) => edge(renameId(e.source), e.sourceHandle ?? '', renameId(e.target), e.targetHandle ?? ''))
  // 書き出し（結合した動画 + アイテム情報）
  nodes.push({ id: 'export', type: 'exportNode', position: { x: x + 1240, y }, data: { type: 'export', label: 'Export', params: { ...DEFAULT_EXPORT_PARAMS }, status: 'idle' } })
  edges.push(edge('merge', 'out-video', 'export', 'in-video-v0'))
  edges.push(edge('cut-set', 'out-item-item', 'export', 'in-item-item'))
  return { nodes, edges, viewport: null }
}

const tryOnNode = (id: string, label: string, role: CutRole, position: { x: number; y: number }): SnapshotNode =>
  ({ id, type: 'tryOnNode', position, data: { type: 'tryOn', label, params: { ...DEFAULT_TRY_ON_PARAMS, role }, status: 'idle', model: null, output: null } })
const exportNode = (position: { x: number; y: number }): SnapshotNode =>
  ({ id: 'export', type: 'exportNode', position, data: { type: 'export', label: 'Export', params: { ...DEFAULT_EXPORT_PARAMS }, status: 'idle' } })

/** 試着 → ターンテーブル 12 秒: 服のカット（SKU ごと・正面/右側面/背面/左側面）→ Try-On × 4（同じ向きのモデル）→ Video Generation × 4 → Video Merge → Export。
 *  作った後に Try-On の「モデル」でモデルを選ぶ（1 回で 4 つの Try-On に向きごとに入る） */
export function buildTryOnTurntableTemplate(): TemplateCanvas {
  const tpl = templateById('turntable12')
  if (!tpl) throw new Error('turntable12 template missing')
  const x = 80, y = 80
  const roles: CutRole[] = ['front', 'right', 'back', 'left']
  const nodes: SnapshotNode[] = [
    { id: 'cut-set', type: 'cutSetInputNode', position: { x, y }, data: { type: 'cutSetInput', label: '服のカット（SKU ごと）', params: {}, status: 'idle', items: [], currentItemId: null } },
    { id: 'base-prompt', type: 'textPromptNode', position: { x, y: y + 560 }, data: { type: 'textPrompt', label: '共通の説明', params: { prompt: DEFAULT_BASE_PROMPT }, status: 'idle' } },
  ]
  const edges: SnapshotEdge[] = []
  roles.forEach((role, i) => {
    nodes.push(tryOnNode(`tryon-${role}`, `試着 ${CUT_ROLE_LABEL[role]}`, role, { x: x + 420, y: y + i * 300 }))
    edges.push(edge('cut-set', cutSetRoleHandle(role), `tryon-${role}`, TRY_ON_GARMENT_HANDLE))
  })
  tpl.shots.forEach((shot, i) => {
    const id = `shot-${i + 1}`
    nodes.push({
      id, type: 'videoGenerationNode', position: { x: x + 840, y: y + i * 320 },
      data: {
        type: 'videoGen', label: `ショット ${i + 1}: ${CUT_ROLE_LABEL[shot.role]}${shot.endRole ? ` → ${CUT_ROLE_LABEL[shot.endRole]}` : ''}`,
        model: PRODUCT_VIDEO_DEFAULT_MODEL, duration: String(shot.duration), resolution: '1080p', aspectRatio: 'auto', fps: 25, audioEnabled: false, seed: null, count: 1,
        status: 'idle', progress: '', videoUrl: null, fileName: null, error: null, requestId: null, requestEndpoint: null, activeDisplayNodeId: null,
        params: { prompt: shot.motion, negativePrompt: DEFAULT_NEGATIVE_PROMPT, autoTurn: true },
      },
    })
    edges.push(edge(`tryon-${shot.role}`, TRY_ON_OUTPUT_HANDLE, id, VIDEO_GEN_START_HANDLE))
    if (shot.endRole) edges.push(edge(`tryon-${shot.endRole}`, TRY_ON_OUTPUT_HANDLE, id, VIDEO_GEN_END_HANDLE))
    edges.push(edge('base-prompt', 'out-text-text-out', id, 'in-text'))
    edges.push(edge(id, VIDEO_OUTPUT_HANDLE, 'merge', videoMergeSlotHandle(i + 1)))
  })
  nodes.push({ id: 'merge', type: 'videoMergeNode', position: { x: x + 1280, y }, data: { type: 'videoMerge', label: 'Video Merge', params: {}, status: 'idle', videoUrl: null } })
  nodes.push(exportNode({ x: x + 1660, y }))
  edges.push(edge('merge', VIDEO_OUTPUT_HANDLE, 'export', 'in-video-v0'))
  edges.push(edge('cut-set', CUT_SET_ITEM_HANDLE, 'export', 'in-item-item'))
  return { nodes, edges, viewport: null }
}

/** 商品写真の背景処理: Batch Input → Remove Background → Product Layout（白背景 1200×1200）→ Export（画像とアイテム情報） */
export function buildPostProductionTemplate(): TemplateCanvas {
  const x = 80, y = 80
  const nodes: SnapshotNode[] = [
    { id: 'batch-input', type: 'batchInputNode', position: { x, y }, data: { type: 'batchInput', label: 'Batch Input', params: { ...DEFAULT_BATCH_INPUT_PARAMS }, status: 'idle', items: [], currentItemId: null } },
    { id: 'cutout', type: 'removeBackgroundNode', position: { x: x + 420, y }, data: { type: 'removeBackground', label: 'Remove Background', params: { ...DEFAULT_CUTOUT_PARAMS }, status: 'idle' } },
    { id: 'layout', type: 'productLayoutNode', position: { x: x + 840, y }, data: { type: 'productLayout', label: 'Product Layout', params: { ...DEFAULT_LAYOUT_PARAMS }, status: 'idle' } },
    exportNode({ x: x + 1260, y }),
  ]
  const edges: SnapshotEdge[] = [
    edge('batch-input', 'out-image-image', 'cutout', REMOVE_BACKGROUND_INPUT),
    edge('cutout', REMOVE_BACKGROUND_OUTPUT_HANDLE, 'layout', PRODUCT_LAYOUT_INPUT_CUTOUT),
    edge('layout', PRODUCT_LAYOUT_OUTPUT, 'export', 'in-image-0'),
    edge('batch-input', 'out-item-item', 'export', 'in-item-item'),
  ]
  return { nodes, edges, viewport: null }
}

/** 商品写真から着用画像（一括）: Batch Input（服の写真）→ Try-On（正面）→ Export。作った後に Try-On の「モデル」でモデルを選ぶ */
export function buildTryOnImagesTemplate(): TemplateCanvas {
  const x = 80, y = 80
  const nodes: SnapshotNode[] = [
    { id: 'batch-input', type: 'batchInputNode', position: { x, y }, data: { type: 'batchInput', label: 'Batch Input', params: { ...DEFAULT_BATCH_INPUT_PARAMS }, status: 'idle', items: [], currentItemId: null } },
    tryOnNode('tryon', '試着 正面', 'front', { x: x + 420, y }),
    exportNode({ x: x + 840, y }),
  ]
  const edges: SnapshotEdge[] = [
    edge('batch-input', 'out-image-image', 'tryon', TRY_ON_GARMENT_HANDLE),
    edge('tryon', TRY_ON_OUTPUT_HANDLE, 'export', 'in-image-0'),
    edge('batch-input', 'out-item-item', 'export', 'in-item-item'),
  ]
  return { nodes, edges, viewport: null }
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'pp-cutout-layout',
    name: '商品写真の背景処理: 切り抜き → 白背景 1200×1200 → 書き出し',
    description: '商品写真をまとめて切り抜き、白背景の規定サイズに配置して SKU 名で書き出す（EC の基本の流れ）',
    kind: 'image',
    goal: 'photo',
    shots: 0,
    seconds: 0,
    summary: 'Batch Input → Remove Background → Product Layout → Export。サイズ・余白・背景は Product Layout で変えられる',
    build: buildPostProductionTemplate,
  },
  ...VIDEO_TEMPLATES.map((t): WorkflowTemplate => ({
    id: `video-${t.id}`,
    name: `商品動画: ${t.label}`,
    description: t.description,
    kind: 'video',
    goal: 'video',
    shots: t.shots.length,
    seconds: totalSeconds(t.shots),
    summary: `${t.shots.length} ショット・約 ${totalSeconds(t.shots)} 秒・Cut Set Input → Video Generation × ${t.shots.length} → Video Merge → Export`,
    build: () => buildProductVideoTemplate(t.id),
  })),
  {
    id: 'tryon-turntable12',
    name: '商品写真から商品動画: 試着 → ターンテーブル 12 秒',
    description: '服のカット（正面・右側面・背面・左側面）にライブラリのモデルを着せ、その着用画像でターンテーブルの動画を作る（SKU ごと・1 回の一括実行）',
    kind: 'video',
    goal: 'video',
    shots: 4,
    seconds: 12,
    summary: '4 ショット・約 12 秒・Cut Set Input（服）→ Try-On × 4 → Video Generation × 4 → Video Merge → Export。作ったら Try-On の「モデル」でモデルを選ぶ（1 回で 4 つに向きごとに入る）',
    build: buildTryOnTurntableTemplate,
  },
  {
    id: 'tryon-images',
    name: '商品写真から着用画像（一括）',
    description: '商品写真（服）ごとに、ライブラリのモデルを着せた着用画像を 1 枚ずつ作る',
    kind: 'image',
    goal: 'tryon',
    shots: 0,
    seconds: 0,
    summary: 'Batch Input（服の写真）→ Try-On → Export。作ったら Try-On の「モデル」でモデルを選ぶ',
    build: buildTryOnImagesTemplate,
  },
]

export const templateOf = (id: string): WorkflowTemplate | null => WORKFLOW_TEMPLATES.find((t) => t.id === id) ?? null
