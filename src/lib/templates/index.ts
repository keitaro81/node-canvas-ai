// ノードが組み済みのテンプレート（2026-10-31・設計 docs/specs/product-video-nodes.md §8、2026-11-01 試着 docs/specs/library-tryon.md §4.2）。
// My Projects の「テンプレートから作成」で新しいワークフローにする。
// - 商品動画（2026-11-08 ユーザー決定）: ターンテーブルは「正面と背面の 2 枚 → Kling Element（参照一式）→ Video Generation 1 本（10 秒・始点も終点も正面）」の 1 本版だけ。
//   4 本を結合する版（ターンテーブル 12 秒）・EC 標準 15 秒・ショート 9 秒・試着 → ターンテーブルは、結果が安定しなかったため一旦外した（商品ごとに参照画像へ写真を入れて対話実行する点は同じ）
// - 試着: 商品写真 → Try-On → 着用画像の書き出し（一括）
// - 2026-11-01: モデルは Model ノード（ライブラリのモデルを選ぶと向きごとの出力ポート）から Try-On につなぐ。回転の指示文は定型文として Video Generation の欄に入れる（トグル廃止）
// - 2026-11-01 ユーザー指示: 組んだノードの名前は種類名のまま（「ショット 1」「試着 正面」のような名前は付けない。向きはノードの中の行で見える）
// - 2026-11-02 メモ 42: 参照画像の「向き」は廃止。どの写真を入れるかは案内（photoHint・見出し「Reference Image（正面）」）で出す。
//   Kling の参照一式は Kling Element ノードにまとめて各ショットの「参照一式 1」につなぎ、ショットの「動き」の先頭に @Element1 を入れる（見える形）
import { CUT_ROLE_LABEL, DEFAULT_BASE_PROMPT, DEFAULT_NEGATIVE_PROMPT, REFERENCE_PRIORITY, type CutRole } from '../video/productVideo'
import { KLING_ELEMENT_OUTPUT, KLING_ELEMENT_SLOTS, VIDEO_GEN_ELEMENT_HANDLES, withElementTag } from '../video/klingElement'
import { PRODUCT_VIDEO_DEFAULT_MODEL, VIDEO_GEN_END_HANDLE, VIDEO_GEN_START_HANDLE, cutSetRoleHandle, type SnapshotEdge, type SnapshotNode } from '../batch/plan'
import { DEFAULT_EXPORT_PARAMS } from '../export/naming'
import { DEFAULT_BATCH_INPUT_PARAMS } from '../batch/items'
import { DEFAULT_TRY_ON_PARAMS, TRY_ON_GARMENT_HANDLE, TRY_ON_MODEL_HANDLE, TRY_ON_OUTPUT_HANDLE } from '../tryon/prompt'
import { DEFAULT_CUTOUT_PARAMS } from '../cutout/engines'
import { DEFAULT_LAYOUT_PARAMS } from '../layout/computeLayout'
import { PRODUCT_LAYOUT_INPUT_CUTOUT, PRODUCT_LAYOUT_OUTPUT } from '../layout/nodeIo'
import { REMOVE_BACKGROUND_INPUT } from '../batch/plan'
import { REMOVE_BACKGROUND_OUTPUT_HANDLE } from '../cutout/upstream'
import { wrapInAppGroup } from '../apps/groupCanvas'

export interface TemplateCanvas { nodes: SnapshotNode[]; edges: SnapshotEdge[]; viewport: null; capsuleGroupId?: string | null }   // capsuleGroupId: 最初から App 化したグループ（一括のテンプレート・2026-11-02）
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
/** 参照画像（作った後にユーザーが写真を入れる）。向きは持たず、どの写真を入れるかの案内だけ付ける（「Reference Image（正面）」・メモ 42） */
const refImageNode = (id: string, role: CutRole, position: { x: number; y: number }): SnapshotNode =>
  ({ id, type: 'referenceImageNode', position, data: { type: 'referenceImage', label: 'Reference Image', imageUrl: null, uploadedImagePreview: null, status: 'idle', photoHint: CUT_ROLE_LABEL[role] } })
/** Kling Element（参照一式）: 正面 1 ＋ 別角度（REFERENCE_PRIORITY 順に最大 3）を出どころからつなぎ、各ショットの「参照一式 1」へ。ショットの動きの先頭に @Element1 */
function wireKlingElement(nodes: SnapshotNode[], edges: SnapshotEdge[], sources: Partial<Record<CutRole, { id: string; handle: string }>>, shotIds: string[], position: { x: number; y: number }): void {
  const frontal = sources.front
  if (!frontal) return
  const refs = REFERENCE_PRIORITY.filter((r) => r !== 'front').map((r) => sources[r]).filter((x): x is { id: string; handle: string } => !!x).slice(0, KLING_ELEMENT_SLOTS.length - 1)
  if (!refs.length) return
  nodes.push({ id: 'element', type: 'klingElementNode', position, data: { type: 'klingElement', label: 'Kling Element', params: {}, status: 'idle' } })
  edges.push(edge(frontal.id, frontal.handle, 'element', KLING_ELEMENT_SLOTS[0].handle))
  refs.forEach((r, i) => edges.push(edge(r.id, r.handle, 'element', KLING_ELEMENT_SLOTS[i + 1].handle)))
  for (const sid of shotIds) {
    edges.push(edge('element', KLING_ELEMENT_OUTPUT, sid, VIDEO_GEN_ELEMENT_HANDLES[0]))
    const shot = nodes.find((n) => n.id === sid)
    if (shot) shot.data = { ...shot.data, params: { ...shot.data.params, prompt: withElementTag(String(shot.data.params?.prompt ?? ''), 1) } }
  }
}
const REF_OUT = 'out-image'

/** ターンテーブル（1 本版・2026-11-08 ユーザー決定）の「動き」「避けたいこと」。日本語のまま入れ、生成時に英訳する */
export const TURNTABLE_SINGLE_MOTION = [
  'モデルがその場で、ゆっくり一定の速さで時計回りに一回転する（360 度）。',
  '最初は正面を向き、中間（5 秒あたり）で背面（参照の後ろ姿のとおり）を向き、最後にまた正面に戻って静かに止まる。',
  '足の位置は変えず、腕は自然に下ろしたまま。服のシルエット・丈・色・ディテールは最初から最後まで写真のとおり。',
].join('\n')
export const TURNTABLE_SINGLE_NEGATIVE = `${DEFAULT_NEGATIVE_PROMPT}、回転の途中で止まる、逆回転、向きが飛ぶ、別の服に変わる`
export const TURNTABLE_SINGLE_SECONDS = 10

/** 商品動画: ターンテーブル 10 秒（1 本版）。参照画像（正面・背面）→ Kling Element（正面 = 主カット・背面 = 別角度 1）→ Video Generation × 1
 *  （Kling v3 Pro・10 秒・始点も終点も正面 = 一回転して元の向きに戻る）。最初からグループに入れて App 化（生成 App の 1 ステージ）。
 *  id は読みやすい固定名（ref-front / ref-back / base-prompt / element / shot-1）。ノードの名前は種類名のまま */
export function buildTurntableSingleTemplate(): TemplateCanvas {
  const x = 80, y = 80
  const nodes: SnapshotNode[] = [
    refImageNode('ref-front', 'front', { x, y }),
    refImageNode('ref-back', 'back', { x, y: y + 460 }),
    { id: 'base-prompt', type: 'textPromptNode', position: { x: x + 420, y }, data: { type: 'textPrompt', label: 'Text Prompt', params: { prompt: DEFAULT_BASE_PROMPT }, status: 'idle' } },
    {
      id: 'shot-1', type: 'videoGenerationNode', position: { x: x + 840, y },
      data: {
        type: 'videoGen', label: 'Video Generation',
        model: PRODUCT_VIDEO_DEFAULT_MODEL, duration: String(TURNTABLE_SINGLE_SECONDS), resolution: '1080p', aspectRatio: 'auto', fps: 25, audioEnabled: false, seed: null, count: 1,
        status: 'idle', progress: '', videoUrl: null, fileName: null, error: null, requestId: null, requestEndpoint: null, activeDisplayNodeId: null,
        params: { prompt: TURNTABLE_SINGLE_MOTION, negativePrompt: TURNTABLE_SINGLE_NEGATIVE, autoTurn: false },
      },
    },
  ]
  const edges: SnapshotEdge[] = [
    edge('ref-front', REF_OUT, 'shot-1', VIDEO_GEN_START_HANDLE),
    edge('ref-front', REF_OUT, 'shot-1', VIDEO_GEN_END_HANDLE),   // 終点も正面 = 一回転して元の向きに戻る
    edge('base-prompt', 'out-text-text-out', 'shot-1', 'in-text'),
  ]
  wireKlingElement(nodes, edges, { front: { id: 'ref-front', handle: REF_OUT }, back: { id: 'ref-back', handle: REF_OUT } }, ['shot-1'], { x: x + 420, y: y + 360 })
  return wrapInAppGroup({ nodes, edges }, 'ターンテーブル（正面＋背面）')
}

const tryOnNode = (id: string, label: string, role: CutRole, position: { x: number; y: number }): SnapshotNode =>
  ({ id, type: 'tryOnNode', position, data: { type: 'tryOn', label, params: { ...DEFAULT_TRY_ON_PARAMS, role }, status: 'idle', model: null, output: null } })
const exportNode = (position: { x: number; y: number }): SnapshotNode =>
  ({ id: 'export', type: 'exportNode', position, data: { type: 'export', label: 'Export', params: { ...DEFAULT_EXPORT_PARAMS }, status: 'idle' } })
/** Model ノード（ライブラリのモデル・作った後に選ぶ）: 向きごとの出力ポートを Try-On の model につなぐ */
const modelNode = (position: { x: number; y: number }): SnapshotNode =>
  ({ id: 'model', type: 'libraryModelNode', position, data: { type: 'libraryModel', label: 'Model', params: {}, status: 'idle', modelId: null, modelName: null, cuts: {} } })

/** 商品写真の背景処理: Batch Input → Remove Background → Product Layout（白背景 1200×1200）→ Export（画像とアイテム情報）。最初からグループに入れて App 化（2026-11-02） */
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
  return wrapInAppGroup({ nodes, edges })
}

/** 商品写真から着用画像（一括）: Batch Input（服の写真）＋ Model ノード → Try-On（正面）→ Export。作った後に Model ノードでモデルを選ぶ。最初からグループに入れて App 化（2026-11-02） */
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
  return wrapInAppGroup({ nodes, edges })
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
  {
    id: 'video-turntable-single',
    name: `商品動画: ターンテーブル ${TURNTABLE_SINGLE_SECONDS} 秒（正面と背面の 2 枚で 1 本）`,
    description: '正面と背面の写真を Kling の参照一式に渡し、その場で一回転する動画を 1 本で作る（4 本に分けて結合しない）',
    kind: 'video',
    goal: 'video',
    shots: 1,
    seconds: TURNTABLE_SINGLE_SECONDS,
    summary: `参照画像（正面・背面）→ Kling Element → Video Generation × 1（${TURNTABLE_SINGLE_SECONDS} 秒・始点と終点は正面）。作ったら正面と背面の写真を入れて「動画を生成」`,
    build: buildTurntableSingleTemplate,
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
