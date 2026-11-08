// 生成 App の「ショット → 結合」（2026-11-02 メモ 54・ユーザー決定）: Batch Input の無い App 化グループで、
// Video Generation を並べて Video Merge でまとめる形（商品動画のテンプレート）を App にできるようにする。
// App には写真と文だけを出し（ショットの設定はキャンバスのまま）、「動画を作る」で全ショットを同時に作り、そろったら自動で結合する。
// 結果は結合した動画＋ショットの一覧（ショットごとに作り直し → 結合し直す）。画面は components/capsule/MergeAppView.tsx
import { videoMergeSlotOf } from '../batch/plan'
import { CUT_ROLE_LABEL } from '../video/productVideo'
import { isModelRole } from '../library/modelRoles'
import { latestVideoOf, videoResultsOf } from '../video/latestVideo'

interface NodeLike { id: string; type?: string; parentId?: string; position?: { x: number; y: number }; data?: unknown }
interface EdgeLike { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

export interface MergeAppShape {
  mergeId: string
  shotIds: string[]          // 結合の順（Video Merge のスロット順）
  exportId: string | null    // 結合の動画を受ける Export（あれば App のダウンロードに使う）
}

const dataOf = (n: NodeLike | undefined): Record<string, unknown> => ((n?.data ?? {}) as Record<string, unknown>)
const RUNNING = new Set(['queued', 'processing', 'generating'])

/** App 化したグループがこの形なら、ショットと結合の id。違えば null（ほかの並列は今までどおり App にしない） */
export function mergeAppShapeOf(groupId: string | null | undefined, nodes: NodeLike[], edges: EdgeLike[]): MergeAppShape | null {
  if (!groupId) return null
  const children = nodes.filter((n) => n.parentId === groupId)
  const byId = new Map(children.map((n) => [n.id, n]))
  const inner = edges.filter((e) => byId.has(e.source) && byId.has(e.target))
  if (children.some((n) => dataOf(n).type === 'batchInput')) return null
  const gens = children.filter((n) => n.type === 'imageGenerationNode' || n.type === 'videoGenerationNode')
  if (gens.length < 2 || gens.some((n) => n.type !== 'videoGenerationNode')) return null
  const merges = children.filter((n) => n.type === 'videoMergeNode')
  if (merges.length !== 1) return null
  const merge = merges[0]
  // 結合の入力 → ショット（Video Generation。間に Video Result を挟んでもよい）。Reference Video（決まった動画）も入れてよい
  const shotOf = (sourceId: string): string | 'clip' | null => {
    const s = byId.get(sourceId)
    if (s?.type === 'videoGenerationNode') return s.id
    if (s?.type === 'referenceVideoNode') return 'clip'
    if (s?.type === 'videoDisplayNode') {
      const g = byId.get(inner.find((x) => x.target === s.id)?.source ?? '')
      return g?.type === 'videoGenerationNode' ? g.id : null
    }
    return null
  }
  const slots = inner
    .filter((e) => e.target === merge.id && videoMergeSlotOf(e.targetHandle) !== null)
    .sort((a, b) => videoMergeSlotOf(a.targetHandle)! - videoMergeSlotOf(b.targetHandle)!)
  const shotIds: string[] = []
  for (const e of slots) {
    const s = shotOf(e.source)
    if (!s) return null
    if (s !== 'clip' && !shotIds.includes(s)) shotIds.push(s)
  }
  // すべての生成ノードがショットとして結合に入り、ショットどうしはつながっていない（前のショットの結果を次の入力にしない）
  if (shotIds.length !== gens.length) return null
  const shots = new Set(shotIds)
  const fromShot = (sourceId: string) => shots.has(sourceId) || (byId.get(sourceId)?.type === 'videoDisplayNode' && inner.some((x) => x.target === sourceId && shots.has(x.source)))
  if (shotIds.some((id) => inner.some((e) => e.target === id && fromShot(e.source)))) return null
  const exp = inner.find((e) => e.source === merge.id && byId.get(e.target)?.type === 'exportNode')
  return { mergeId: merge.id, shotIds, exportId: exp?.target ?? null }
}

export interface MergeAppInput { nodeId: string; kind: 'image' | 'text'; label: string; hint: string | null }

/** App の入力欄: グループの中の Reference Image / Text Prompt のうち、ショットか Kling Element につながり「表示」を外していないもの（画像 → 文、それぞれ上から） */
export function mergeAppInputsOf(groupId: string, nodes: NodeLike[], edges: EdgeLike[], shape: MergeAppShape): MergeAppInput[] {
  const children = nodes.filter((n) => n.parentId === groupId)
  const targets = new Set([...shape.shotIds, ...children.filter((n) => n.type === 'klingElementNode').map((n) => n.id)])
  const hidden = (n: NodeLike, field: string) => ((dataOf(n).capsuleFields ?? {}) as Record<string, { capsuleVisibility?: string } | undefined>)[field]?.capsuleVisibility === 'hidden'
  const used = (n: NodeLike) => edges.some((e) => e.source === n.id && targets.has(e.target))
  const pos = (n: NodeLike) => n.position ?? { x: 0, y: 0 }
  const sorted = (list: NodeLike[]) => [...list].sort((a, b) => pos(a).y - pos(b).y || pos(a).x - pos(b).x)
  const images = sorted(children.filter((n) => n.type === 'referenceImageNode' && used(n) && !hidden(n, 'imageUrl')))
  const texts = sorted(children.filter((n) => n.type === 'textPromptNode' && used(n) && !hidden(n, 'prompt')))
  const label = (n: NodeLike, fallback: string) => (typeof dataOf(n).label === 'string' && (dataOf(n).label as string).trim()) || fallback
  return [
    ...images.map((n): MergeAppInput => ({ nodeId: n.id, kind: 'image', label: label(n, 'Reference Image'), hint: typeof dataOf(n).photoHint === 'string' && (dataOf(n).photoHint as string).trim() ? (dataOf(n).photoHint as string).trim() : null })),
    ...texts.map((n): MergeAppInput => ({ nodeId: n.id, kind: 'text', label: label(n, 'Text Prompt'), hint: null })),
  ]
}

/** 写真が入っていない画像の欄 */
export const missingImageInputs = (inputs: MergeAppInput[], nodes: NodeLike[]): MergeAppInput[] =>
  inputs.filter((i) => i.kind === 'image' && !(() => { const d = dataOf(nodes.find((n) => n.id === i.nodeId)); return d.imageUrl || d.uploadedImagePreview || d.output })())

export interface ShotState { status: 'idle' | 'running' | 'done' | 'failed'; videoUrl: string | null; error: string | null }

/** 生成 App の「今回の実行」。Video Merge ノードの data.appRun に保存する（画面を開き直しても・読み込み直しても、そろったら結合に進めるため・2026-11-08 メモ 71） */
export interface MergeAppRun { id: number; startedAt: string; since: Record<string, string[]> }
export function mergeAppRunOf(mergeData: unknown): MergeAppRun | null {
  const r = (mergeData as { appRun?: unknown } | undefined)?.appRun as Partial<MergeAppRun> | null | undefined
  if (!r || typeof r !== 'object' || typeof r.id !== 'number' || typeof r.startedAt !== 'string' || !r.since || typeof r.since !== 'object') return null
  const since: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(r.since)) if (Array.isArray(v)) since[k] = v.filter((x): x is string => typeof x === 'string')
  return { id: r.id, startedAt: r.startedAt, since }
}
/** 作り始めてからこれだけ経っても結果のノードが無く、Video Generation も動いていなければ「結果が見つからない」とみなす（読み込み直しで生成が途切れたとき） */
export const LOST_AFTER_MS = 90_000
export const LOST_ERROR = '結果が見つかりません（ページを読み込み直した、または時間切れ）。作り直してください'

/**
 * ショットの状態。since（作り始める前にあった Video Result の id）を渡すと、それより後にできた結果だけを見る（今回の実行の進み）。
 * since が無いときは、最後にできた動画を見せる
 */
export function shotStateOf(shotId: string, nodes: NodeLike[], edges: EdgeLike[], since?: Set<string> | null, opts?: { startedAt?: number | null; now?: number }): ShotState {
  const d = dataOf(nodes.find((n) => n.id === shotId))
  const vgRunning = RUNNING.has(String(d.status ?? ''))
  const vgError = d.status === 'failed' || d.status === 'error' ? (typeof d.error === 'string' && d.error ? d.error : '生成に失敗しました') : null
  if (since) {
    const fresh = videoResultsOf(shotId, nodes, edges).filter((r) => !since.has(r.id))
    const r = fresh[0]
    if (r) {
      const rd = dataOf(r)
      const url = typeof rd.videoUrl === 'string' && rd.videoUrl ? rd.videoUrl : null
      if (url && rd.status !== 'failed') return { status: 'done', videoUrl: url, error: null }
      if (rd.status === 'failed') return { status: 'failed', videoUrl: null, error: typeof rd.error === 'string' && rd.error ? rd.error : '生成に失敗しました' }
      // 結果のノードはあるが動画が入らないまま、Video Generation も動いていない（読み込み直しで生成が途切れた）→ 時間が経てば「結果が見つからない」
      if (!vgRunning && opts?.startedAt != null && (opts.now ?? Date.now()) - opts.startedAt > LOST_AFTER_MS) return { status: 'failed', videoUrl: null, error: LOST_ERROR }
      return { status: 'running', videoUrl: null, error: null }
    }
    if (vgError && !vgRunning) return { status: 'failed', videoUrl: null, error: vgError }
    if (!vgRunning && opts?.startedAt != null && (opts.now ?? Date.now()) - opts.startedAt > LOST_AFTER_MS) return { status: 'failed', videoUrl: null, error: LOST_ERROR }
    return { status: 'running', videoUrl: null, error: null }
  }
  const url = latestVideoOf(shotId, nodes, edges)
  if (vgRunning) return { status: 'running', videoUrl: url, error: null }
  if (vgError) return { status: 'failed', videoUrl: url, error: vgError }
  return { status: url ? 'done' : 'idle', videoUrl: url, error: null }
}

export type AutoMergeDecision = 'wait' | 'merge' | 'stop'
/** 今回の実行の進みから結合に進むか。wait = まだ作っている / merge = 全ショットの動画がそろった / stop = 失敗したショットがある（結合しない・作り直しを待つ） */
export function autoMergeDecision(run: MergeAppRun, shotIds: string[], nodes: NodeLike[], edges: EdgeLike[], now = Date.now()): { decision: AutoMergeDecision; states: Record<string, ShotState> } {
  const parsed = Date.parse(run.startedAt)
  const startedAt = Number.isFinite(parsed) ? parsed : null
  const states: Record<string, ShotState> = {}
  for (const [id, before] of Object.entries(run.since)) states[id] = shotStateOf(id, nodes, edges, new Set(before), { startedAt, now })
  const list = Object.values(states)
  if (list.some((s) => s.status === 'running')) return { decision: 'wait', states }
  if (list.some((s) => s.status === 'failed')) return { decision: 'stop', states }
  return { decision: shotIds.every((id) => !!latestVideoOf(id, nodes, edges)) ? 'merge' : 'stop', states }
}

/** ショットの見出し（始点 → 終点の写真の向き。Reference Image の見出しの向きか、Model ノードの向きのポート） */
export function shotTurnLabel(shotId: string, nodes: NodeLike[], edges: EdgeLike[]): string | null {
  const hintOf = (handle: string): string | null => {
    const e = edges.find((x) => x.target === shotId && x.targetHandle === handle)
    if (!e) return null
    const s = nodes.find((n) => n.id === e.source)
    const d = dataOf(s)
    if (s?.type === 'referenceImageNode' && typeof d.photoHint === 'string' && d.photoHint.trim()) return d.photoHint.trim()
    const role = e.sourceHandle?.startsWith('out-image-') ? e.sourceHandle.slice('out-image-'.length) : null
    return s?.type === 'libraryModelNode' && isModelRole(role) ? CUT_ROLE_LABEL[role] : null
  }
  const a = hintOf('in-image'), b = hintOf('in-image-end')
  return a && b ? `${a} → ${b}` : a ?? b
}
