// ノードが組み済みのテンプレート（2026-10-31・設計 docs/specs/product-video-nodes.md §8、2026-11-01 試着 docs/specs/library-tryon.md §4.2）。
// My Projects の「テンプレートから作成」で新しいワークフローにする。
// - 商品動画の 3 構成（EC 標準 15 秒 / ターンテーブル 12 秒 / ショート 9 秒）は、向きつきの参照画像 → Video Generation × ショット → Video Merge → Export に組む
//   （2026-11-01: Cut Set Input と動画の一括処理は廃止。商品ごとに参照画像へ写真を入れて対話実行する）
// - 試着（2b-4）: 服のカット（SKU ごと）→ Try-On × 向き → ターンテーブルの動画、商品写真 → Try-On → 着用画像の書き出し
// - 2026-11-01: モデルは Model ノード（ライブラリのモデルを選ぶと向きごとの出力ポート）から Try-On につなぐ。回転の指示文は定型文として Video Generation の欄に入れる（トグル廃止）
// - 2026-11-01 ユーザー指示: 組んだノードの名前は種類名のまま（「ショット 1」「試着 正面」のような名前は付けない。向きはノードの中の行で見える）
import { DEFAULT_BASE_PROMPT, DEFAULT_NEGATIVE_PROMPT, VIDEO_TEMPLATES, templateById, totalSeconds, turnPreset, withTurnMotion, withTurnNegative, type CutRole, type VideoShotSpec } from '../video/productVideo'
import { PRODUCT_VIDEO_DEFAULT_MODEL, VIDEO_GEN_END_HANDLE, VIDEO_GEN_START_HANDLE, VIDEO_OUTPUT_HANDLE, cutSetRoleHandle, videoMergeSlotHandle, type SnapshotEdge, type SnapshotNode } from '../batch/plan'
import { DEFAULT_EXPORT_PARAMS } from '../export/naming'
import { DEFAULT_BATCH_INPUT_PARAMS } from '../batch/items'
import { DEFAULT_TRY_ON_PARAMS, TRY_ON_GARMENT_HANDLE, TRY_ON_MODEL_HANDLE, TRY_ON_OUTPUT_HANDLE } from '../tryon/prompt'
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
/** 向きつきの参照画像（作った後にユーザーが写真を入れる） */
const refImageNode = (id: string, role: CutRole, position: { x: number; y: number }): SnapshotNode =>
  ({ id, type: 'referenceImageNode', position, data: { type: 'referenceImage', label: 'Reference Image', imageUrl: null, uploadedImagePreview: null, status: 'idle', role } })
/** ショット = Video Generation（Kling v3 Pro・写真の比率）。終了フレームのあるショットは回転の定型文を「動き」「避けたいこと」に入れる */
const videoShotNode = (id: string, shot: VideoShotSpec, position: { x: number; y: number }): SnapshotNode => ({
  id, type: 'videoGenerationNode', position,
  data: {
    type: 'videoGen', label: 'Video Generation',
    model: PRODUCT_VIDEO_DEFAULT_MODEL, duration: String(shot.duration), resolution: '1080p', aspectRatio: 'auto', fps: 25, audioEnabled: false, seed: null, count: 1,
    status: 'idle', progress: '', videoUrl: null, fileName: null, error: null, requestId: null, requestEndpoint: null, activeDisplayNodeId: null,
    params: shot.endRole
      ? (() => { const t = turnPreset(shot.role, shot.endRole); return { prompt: withTurnMotion(shot.motion, t.motion), negativePrompt: withTurnNegative(DEFAULT_NEGATIVE_PROMPT, t.negativeJp), autoTurn: false } })()
      : { prompt: shot.motion, negativePrompt: DEFAULT_NEGATIVE_PROMPT, autoTurn: false },
  },
})
/** ショットで使う向き（最初に出てくる順） */
const rolesOf = (shots: VideoShotSpec[]): CutRole[] => [...new Set(shots.flatMap((sh) => [sh.role, ...(sh.endRole ? [sh.endRole] : [])]))]
const REF_OUT = 'out-image'
const SHOT_GAP = 660, REF_GAP = 440

/** 商品動画のテンプレート（VIDEO_TEMPLATES の id）: 向きつきの参照画像 × 必要な向き → Text Prompt（共通の説明）→ Video Generation × ショット → Video Merge → Export。
 *  id は読みやすい固定名（ref-<向き> / base-prompt / shot-N / merge / export）。ノードの名前は種類名のまま */
export function buildProductVideoTemplate(templateId: string): TemplateCanvas {
  const tpl = templateById(templateId)
  if (!tpl) throw new Error(`unknown template: ${templateId}`)
  const x = 80, y = 80
  const nodes: SnapshotNode[] = rolesOf(tpl.shots).map((role, i) => refImageNode(`ref-${role}`, role, { x, y: y + i * REF_GAP }))
  nodes.push({ id: 'base-prompt', type: 'textPromptNode', position: { x: x + 420, y }, data: { type: 'textPrompt', label: 'Text Prompt', params: { prompt: DEFAULT_BASE_PROMPT }, status: 'idle' } })
  const edges: SnapshotEdge[] = []
  tpl.shots.forEach((shot, i) => {
    const id = `shot-${i + 1}`
    nodes.push(videoShotNode(id, shot, { x: x + 840, y: y + i * SHOT_GAP }))
    edges.push(edge(`ref-${shot.role}`, REF_OUT, id, VIDEO_GEN_START_HANDLE))
    if (shot.endRole) edges.push(edge(`ref-${shot.endRole}`, REF_OUT, id, VIDEO_GEN_END_HANDLE))
    edges.push(edge('base-prompt', 'out-text-text-out', id, 'in-text'))
    edges.push(edge(id, VIDEO_OUTPUT_HANDLE, 'merge', videoMergeSlotHandle(i + 1)))
  })
  nodes.push({ id: 'merge', type: 'videoMergeNode', position: { x: x + 1260, y }, data: { type: 'videoMerge', label: 'Video Merge', params: {}, status: 'idle', videoUrl: null } })
  nodes.push(exportNode({ x: x + 1640, y }))
  edges.push(edge('merge', VIDEO_OUTPUT_HANDLE, 'export', 'in-video-v0'))
  return { nodes, edges, viewport: null }
}

const tryOnNode = (id: string, label: string, role: CutRole, position: { x: number; y: number }): SnapshotNode =>
  ({ id, type: 'tryOnNode', position, data: { type: 'tryOn', label, params: { ...DEFAULT_TRY_ON_PARAMS, role }, status: 'idle', model: null, output: null } })
const exportNode = (position: { x: number; y: number }): SnapshotNode =>
  ({ id: 'export', type: 'exportNode', position, data: { type: 'export', label: 'Export', params: { ...DEFAULT_EXPORT_PARAMS }, status: 'idle' } })
/** Model ノード（ライブラリのモデル・作った後に選ぶ）: 向きごとの出力ポートを Try-On の model につなぐ */
const modelNode = (position: { x: number; y: number }): SnapshotNode =>
  ({ id: 'model', type: 'libraryModelNode', position, data: { type: 'libraryModel', label: 'Model', params: {}, status: 'idle', modelId: null, modelName: null, cuts: {} } })

/** 試着 → ターンテーブル 12 秒: 服の写真（参照画像・向き = 正面/右側面/背面/左側面）＋ Model → Try-On × 4（同じ向き）→ Video Generation × 4 → Video Merge → Export。
 *  作った後に参照画像へ服の写真を向きどおりに入れ、Model ノードでモデルを選ぶ。ショットの「動き」「避けたいこと」には回転の定型文が入っている */
export function buildTryOnTurntableTemplate(): TemplateCanvas {
  const tpl = templateById('turntable12')
  if (!tpl) throw new Error('turntable12 template missing')
  const x = 80, y = 80
  const roles: CutRole[] = ['front', 'right', 'back', 'left']
  const nodes: SnapshotNode[] = roles.map((role, i) => refImageNode(`garment-${role}`, role, { x, y: y + i * REF_GAP }))
  nodes.push(modelNode({ x, y: y + roles.length * REF_GAP }))
  const edges: SnapshotEdge[] = []
  roles.forEach((role, i) => {
    nodes.push(tryOnNode(`tryon-${role}`, 'Try-On', role, { x: x + 420, y: y + i * REF_GAP }))
    edges.push(edge(`garment-${role}`, REF_OUT, `tryon-${role}`, TRY_ON_GARMENT_HANDLE))
    edges.push(edge('model', cutSetRoleHandle(role), `tryon-${role}`, TRY_ON_MODEL_HANDLE))
  })
  nodes.push({ id: 'base-prompt', type: 'textPromptNode', position: { x: x + 840, y }, data: { type: 'textPrompt', label: 'Text Prompt', params: { prompt: DEFAULT_BASE_PROMPT }, status: 'idle' } })
  tpl.shots.forEach((shot, i) => {
    const id = `shot-${i + 1}`
    nodes.push(videoShotNode(id, shot, { x: x + 1260, y: y + i * SHOT_GAP }))
    edges.push(edge(`tryon-${shot.role}`, TRY_ON_OUTPUT_HANDLE, id, VIDEO_GEN_START_HANDLE))
    if (shot.endRole) edges.push(edge(`tryon-${shot.endRole}`, TRY_ON_OUTPUT_HANDLE, id, VIDEO_GEN_END_HANDLE))
    edges.push(edge('base-prompt', 'out-text-text-out', id, 'in-text'))
    edges.push(edge(id, VIDEO_OUTPUT_HANDLE, 'merge', videoMergeSlotHandle(i + 1)))
  })
  nodes.push({ id: 'merge', type: 'videoMergeNode', position: { x: x + 1680, y }, data: { type: 'videoMerge', label: 'Video Merge', params: {}, status: 'idle', videoUrl: null } })
  nodes.push(exportNode({ x: x + 2060, y }))
  edges.push(edge('merge', VIDEO_OUTPUT_HANDLE, 'export', 'in-video-v0'))
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

/** 商品写真から着用画像（一括）: Batch Input（服の写真）＋ Model ノード → Try-On（正面）→ Export。作った後に Model ノードでモデルを選ぶ */
export function buildTryOnImagesTemplate(): TemplateCanvas {
  const x = 80, y = 80
  const nodes: SnapshotNode[] = [
    { id: 'batch-input', type: 'batchInputNode', position: { x, y }, data: { type: 'batchInput', label: 'Batch Input', params: { ...DEFAULT_BATCH_INPUT_PARAMS }, status: 'idle', items: [], currentItemId: null } },
    modelNode({ x, y: y + 520 }),
    tryOnNode('tryon', 'Try-On', 'front', { x: x + 420, y }),
    exportNode({ x: x + 840, y }),
  ]
  const edges: SnapshotEdge[] = [
    edge('batch-input', 'out-image-image', 'tryon', TRY_ON_GARMENT_HANDLE),
    edge('model', cutSetRoleHandle('front'), 'tryon', TRY_ON_MODEL_HANDLE),
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
    summary: `${t.shots.length} ショット・約 ${totalSeconds(t.shots)} 秒・参照画像（向き）× ${rolesOf(t.shots).length} → Video Generation × ${t.shots.length} → Video Merge → Export。作ったら参照画像に商品の写真を向きどおりに入れる`,
    build: () => buildProductVideoTemplate(t.id),
  })),
  {
    id: 'tryon-turntable12',
    name: '商品写真から商品動画: 試着 → ターンテーブル 12 秒',
    description: '服の写真（正面・右側面・背面・左側面）にライブラリのモデルを着せ、その着用画像でターンテーブルの動画を作る（1 商品ずつ）',
    kind: 'video',
    goal: 'video',
    shots: 4,
    seconds: 12,
    summary: '4 ショット・約 12 秒・参照画像（服・向き）× 4 ＋ Model → Try-On × 4 → Video Generation × 4 → Video Merge → Export。作ったら参照画像に服の写真を向きどおりに入れ、Model ノードでモデルを選ぶ',
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
    summary: 'Batch Input（服の写真）＋ モデル → Try-On → Export。作ったら「モデル」ノードでモデルを選ぶ',
    build: buildTryOnImagesTemplate,
  },
]

export const templateOf = (id: string): WorkflowTemplate | null => WORKFLOW_TEMPLATES.find((t) => t.id === id) ?? null
