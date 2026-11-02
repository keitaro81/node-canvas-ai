// App の判定（2026-11-02・一括処理と App の再設計 段階 3）: App = App 化したグループ。グループの中身で種類が決まる。
// - グループの中に入口（Batch Input）が 1 つ → batch（一括 App。範囲はグループの中だけ）
// - 入口が無い → generation（従来の App モード = CapsuleView）
// - 入口が 2 つ以上 → batch だが entryId が無い（App 側で「入口は 1 つに」と案内し、一括 App としては動かない）
// - 救済: App 化したグループが無い既存ワークフローは、Batch Input があればキャンバス全体を 1 つの一括 App とみなす
// - 1 キャンバス 1 App（複数 App はやらない・2026-11-02 ユーザー決定）
// 一括 App の結果は 1 種類（2026-11-02 決定・appBatchPlanOf）: 画像だけなら枝分かれしてよい（枝ごとの列・フォルダ）。動画は写真 1 枚につき 1 本。
// 画像と動画の両方ができる構成・動画が 2 本以上できる構成は、グループと App に注意を出して動かさない
// （2026-11-01: 商品動画（Cut Set Input / 旧 Product Video）の App は廃止）
import { nodeLabelOf, planTasks, pruneToEntry, type PlannedTask, type SnapshotEdge, type SnapshotNode } from '../batch/plan'

export type AppKind = 'batch' | 'generation'

export interface AppCanvasLike {
  capsuleGroupId?: string | null
  nodes?: Array<{ id?: string; type?: string; parentId?: string; data?: Record<string, unknown> } | null> | null
  edges?: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null } | null> | null
  promptTranslations?: Record<string, string>
}
export interface AppScope { kind: AppKind | null; groupId: string | null; entryId: string | null; entryCount: number }
export type AppIssueCode = 'entries' | 'mixed' | 'videos'
export interface AppIssue { code: AppIssueCode; message: string }
/** 一括 App の計画（App の「処理内容」）と問題。nodes = 範囲（グループの中）のノード */
export interface AppBatchPlan { entryId: string; tasks: PlannedTask[]; warnings: string[]; excluded: Record<string, string>; issue: AppIssue | null; nodes: SnapshotNode[] }

const NONE: AppScope = { kind: null, groupId: null, entryId: null, entryCount: 0 }
const isEntry = (n: { data?: Record<string, unknown> } | null | undefined) => n?.data?.type === 'batchInput'
const nodesOf = (canvas: unknown): Array<{ id?: string; type?: string; parentId?: string; data?: Record<string, unknown> }> => {
  const c = canvas as AppCanvasLike | null | undefined
  return Array.isArray(c?.nodes) ? c!.nodes!.filter((n): n is NonNullable<typeof n> => !!n) : []
}

export function appScopeOf(canvas: unknown): AppScope {
  const c = canvas as AppCanvasLike | null | undefined
  const nodes = nodesOf(canvas)
  if (!nodes.length) return NONE
  const group = nodes.find((n) => n.type === 'groupNode' && (n.data?.capsuleEnabled === true || (!!c?.capsuleGroupId && n.id === c.capsuleGroupId)))
  if (group) {
    const entries = nodes.filter((n) => n.parentId === group.id && isEntry(n))
    if (!entries.length) return { kind: 'generation', groupId: group.id ?? null, entryId: null, entryCount: 0 }
    return { kind: 'batch', groupId: group.id ?? null, entryId: entries.length === 1 ? entries[0].id ?? null : null, entryCount: entries.length }
  }
  const entries = nodes.filter(isEntry)
  if (entries.length) return { kind: 'batch', groupId: null, entryId: entries[0].id ?? null, entryCount: entries.length }
  return NONE
}

export function appKindOf(canvas: unknown): AppKind | null {
  return appScopeOf(canvas).kind
}

/**
 * グループ（null = キャンバス全体）を一括 App として動かすときの計画と問題。入口（Batch Input）が無ければ null（生成 App の判定は capsuleUtils 側）。
 * 範囲はグループの子ノードと、その中だけの辺。入口の枝だけに刈り込んでから計画する（BatchAppView の投入と同じ写し方）
 */
export function appBatchPlanOf(canvas: unknown, groupId: string | null): AppBatchPlan | null {
  const c = canvas as AppCanvasLike | null | undefined
  const inScope = nodesOf(canvas).filter((n): n is typeof n & { id: string } => typeof n.id === 'string' && (groupId ? n.parentId === groupId : n.type !== 'groupNode'))
  const entries = inScope.filter(isEntry)
  if (!entries.length) return null
  const nodes: SnapshotNode[] = inScope
  const entryId = entries[0].id
  if (entries.length > 1) {
    return { entryId, tasks: [], warnings: [], excluded: {}, nodes, issue: { code: 'entries', message: `入口（Batch Input）が ${entries.length} つあります。一括 App として動かすには 1 つにしてください` } }
  }
  const ids = new Set(inScope.map((n) => n.id))
  const edges: SnapshotEdge[] = (Array.isArray(c?.edges) ? c!.edges! : []).filter((e): e is NonNullable<typeof e> => !!e && ids.has(e.source) && ids.has(e.target))
  const { tasks, warnings, excluded, droppedForVideo } = planTasks(pruneToEntry({ nodes, edges, promptTranslations: c?.promptTranslations }, entryId))
  let issue: AppIssue | null = null
  const videos = tasks.filter((t) => (t.kind === 'videoShot' || t.kind === 'videoMerge') && t.terminal)
  if (videos.length) {
    const layouts = inScope.filter((n) => n.data?.type === 'productLayout')
    const mixed = [...droppedForVideo.map((t) => t.label), ...layouts.map((n) => nodeLabelOf(n))]
    if (mixed.length) issue = { code: 'mixed', message: `画像と動画の両方ができる構成です（${mixed.join('・')}）。App の結果は 1 種類にしてください（画像のノードを外すか、別のグループに分けてください）` }
    else if (videos.length > 1) issue = { code: 'videos', message: `写真 1 枚から動画が ${videos.length} 本できる構成です（${videos.map((t) => t.label).join('・')}）。動画は 1 本にしてください（ショットは Video Merge でまとめてください）` }
  }
  return { entryId, tasks, warnings, excluded, nodes, issue }
}

/** 一括 App として動かせない理由（null = 問題なし、または入口が無い） */
export function appIssueOf(canvas: unknown, groupId: string | null): AppIssue | null {
  return appBatchPlanOf(canvas, groupId)?.issue ?? null
}

export const APP_KIND_LABEL: Record<AppKind, string> = { batch: '撮影後工程', generation: '生成' }
