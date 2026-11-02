// App の判定（2026-11-02・一括処理と App の再設計 段階 3）: App = App 化したグループ。グループの中身で種類が決まる。
// - グループの中に入口（Batch Input）が 1 つ → batch（一括 App。範囲はグループの中だけ）
// - 入口が無い → generation（従来の App モード = CapsuleView）
// - 入口が 2 つ以上 → batch だが entryId が無い（App 側で「入口は 1 つに」と案内し、一括 App としては動かない）
// - 救済: App 化したグループが無い既存ワークフローは、Batch Input があればキャンバス全体を 1 つの一括 App とみなす
// - 1 キャンバス 1 App（複数 App はやらない・2026-11-02 ユーザー決定）
// 一括 App は「写真 1 枚から最終の出力 1 つ」（2026-11-02 夜 決定・メモ 61。段階 4 の「画像だけなら枝分かれしてよい」を見直し）:
// 最終の出力 = その結果をほかの AI 処理が使っていない写真ごとの処理（枝の終わり）。途中の結果は数えない（合流して最後が 1 つなら OK）。
// 例外は Product Layout のバリアント（同じ切り抜きの大きさ・背景違い）。動画は写真 1 枚につき 1 本。
// 次の構成はグループと App に注意を出して動かさない（App 化のボタンも断る）。判定の順: 入口が 2 つ以上 → 指示が空（メモ 52）→
// 一括で使えない AI ノードがある（メモ 59・理由はすべて）→ 切り抜きが 2 つ以上（メモ 48）→ 画像と動画の混在 → 動画が 2 本以上 → 最終の出力が 2 つ以上（メモ 61）
// 一括に入らなかった AI ノードの理由は unplannedReasons で補う（メモ 50）
// （2026-11-01: 商品動画（Cut Set Input / 旧 Product Video）の App は廃止）
import { depsOf, nodeLabelOf, planTasks, pruneToEntry, type PlannedTask, type SnapshotEdge, type SnapshotNode } from '../batch/plan'

export type AppKind = 'batch' | 'generation'

export interface AppCanvasLike {
  capsuleGroupId?: string | null
  nodes?: Array<{ id?: string; type?: string; parentId?: string; data?: Record<string, unknown> } | null> | null
  edges?: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null } | null> | null
  promptTranslations?: Record<string, string>
}
export interface AppScope { kind: AppKind | null; groupId: string | null; entryId: string | null; entryCount: number }
export type AppIssueCode = 'entries' | 'prompt' | 'excluded' | 'cutouts' | 'mixed' | 'videos' | 'outputs'
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

/** App の範囲（グループの子ノードと、子どうしをつなぐ辺）。groupId が無い（救済のキャンバス全体）ときはそのまま返す。
 *  App の画面（処理・結果の列・背景・Export の設定・レイアウト設定）はすべてこれを見る（2026-11-02 メモ 45） */
export function appCanvasOf<N extends { id: string; parentId?: string }, E extends { source: string; target: string }>(nodes: N[], edges: E[], groupId: string | null): { nodes: N[]; edges: E[] } {
  if (!groupId) return { nodes, edges }
  const inGroup = nodes.filter((n) => n.parentId === groupId)
  const ids = new Set(inGroup.map((n) => n.id))
  return { nodes: inGroup, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }
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
  const { tasks, warnings, excluded: planned, droppedForVideo, emptyPrompt } = planTasks(pruneToEntry({ nodes, edges, promptTranslations: c?.promptTranslations }, entryId))
  const excluded = { ...planned, ...unplannedReasons(nodes, edges, tasks, planned) }
  let issue: AppIssue | null = null
  const videos = tasks.filter((t) => (t.kind === 'videoShot' || t.kind === 'videoMerge') && t.terminal)
  const cutouts = tasks.filter((t) => t.kind === 'cutout')
  // 動画だけの構成のため作らない画像（droppedForVideo）は「画像と動画の混在」の方で知らせる
  const dropped = new Set(droppedForVideo.map((t) => t.nodeId))
  const excludedReasons = Object.entries(excluded).filter(([id]) => !dropped.has(id)).map(([, r]) => r)
  const finals = finalOutputsOf(nodes, edges, tasks)
  if (emptyPrompt.length) {
    issue = { code: 'prompt', message: `${countedLabels(emptyPrompt.map((id) => nodeLabelOf(nodes.find((n) => n.id === id))))} の指示が空です。Image Generation はプロンプトの欄、Video Generation は「動き」の欄に書くか、Text Prompt をつないでください` }
  } else if (excludedReasons.length) {
    // 一括で使えない AI ノードがあれば App にしない（2026-11-02 メモ 59・理由はすべて）。理由に直し方が入っている
    issue = { code: 'excluded', message: `一括で使えないノードがあります。${excludedReasons[0]}${excludedReasons.length > 1 ? `（ほか ${excludedReasons.length - 1} 件）` : ''}` }
  } else if (cutouts.length > 1) {
    issue = { code: 'cutouts', message: `Remove Background が ${cutouts.length} つあります。一括 App の切り抜きは 1 つにしてください（レイアウトの違いは Product Layout のバリアントで作れます）` }
  } else if (videos.length) {
    const layouts = inScope.filter((n) => n.data?.type === 'productLayout')
    const mixed = [...droppedForVideo.map((t) => t.label), ...layouts.map((n) => nodeLabelOf(n))]
    if (mixed.length) issue = { code: 'mixed', message: `画像と動画の両方ができる構成です（${mixed.join('・')}）。App の結果は 1 種類にしてください（画像のノードを外すか、別のグループに分けてください）` }
    else if (videos.length > 1) issue = { code: 'videos', message: `写真 1 枚から動画が ${videos.length} 本できる構成です（${videos.map((t) => t.label).join('・')}）。動画は 1 本にしてください（ショットは Video Merge でまとめてください）` }
  }
  if (!issue && finals.length > 1) {
    issue = { code: 'outputs', message: `写真 1 枚から ${finals.length} 種類（${countedLabels(finals.map((f) => f.label))}）を作る構成です。一括 App で作るものは 1 種類にしてください（大きさや背景の違いは Product Layout のバリアントで作れます。途中の結果を次の処理につなぐのはかまいません）` }
  }
  return { entryId, tasks, warnings, excluded, nodes, issue }
}

/**
 * 最終の出力（2026-11-02 メモ 61）: 写真ごとの処理のうち、その結果をほかの AI 処理が使っていないもの（枝の終わり）。
 * Product Layout につながる切り抜きは「レイアウト（バリアント）」として 1 つに数える（AI がその切り抜きを使っていても、レイアウトは別の出力になる）
 */
export function finalOutputsOf(nodes: SnapshotNode[], edges: SnapshotEdge[], tasks: PlannedTask[]): Array<{ nodeId: string; label: string; layout: boolean }> {
  const items = tasks.filter((t) => t.scope === 'item')
  const consumed = new Set(items.flatMap((t) => depsOf(t.inputs)))
  const kindOf = (id: string) => nodes.find((n) => n.id === id)?.data?.type
  const feedsLayout = (id: string) => edges.some((e) => e.source === id && kindOf(e.target) === 'productLayout')
  const out: Array<{ nodeId: string; label: string; layout: boolean }> = []
  for (const t of items) {
    if (out.some((o) => o.nodeId === t.nodeId)) continue
    const layout = t.kind === 'cutout' && feedsLayout(t.nodeId)
    if (consumed.has(t.nodeId) && !layout) continue
    out.push({ nodeId: t.nodeId, label: layout ? 'Product Layout' : t.label, layout })
  }
  return out
}

/** 一括に入らなかった AI ノードの理由（計画が理由を残さない場合だけ・メモ 50）。
 *  - Product Layout の画像をつないだ → 一括では Product Layout の画像を使えない（Product Layout は結果の画面で描くもので、サーバーの処理に入らない）
 *  - それ以外 → Batch Input の写真につながっていない（キャンバスで個別に実行するノード）
 *  背景生成用の Image Generation（Product Layout の背景入力につなぐ）は計画が注意を出すので除く */
function unplannedReasons(nodes: SnapshotNode[], edges: SnapshotEdge[], tasks: PlannedTask[], planned: Record<string, string>): Record<string, string> {
  const AI = new Set(['removeBackground', 'imageGen', 'tryOn', 'videoGen', 'videoMerge'])
  const kindOf = (id: string) => { const n = nodes.find((x) => x.id === id); return (n?.data?.type as string | undefined) ?? (n?.type === 'videoGenerationNode' ? 'videoGen' : undefined) }
  const out: Record<string, string> = {}
  for (const n of nodes) {
    const k = kindOf(n.id)
    if (!k || !AI.has(k) || planned[n.id] || tasks.some((t) => t.nodeId === n.id)) continue
    const label = nodeLabelOf(n)
    const into = edges.filter((e) => e.target === n.id)
    if (k === 'imageGen' && edges.some((e) => e.source === n.id && kindOf(e.target) === 'productLayout')) continue
    out[n.id] = into.some((e) => kindOf(e.source) === 'productLayout')
      ? `${label} は Product Layout の画像を一括では使えないため対象外です。写真か切り抜きをつないでください`
      : `${label} は Batch Input の写真につながっていないため、一括の対象外です（キャンバスで個別に実行します）`
  }
  return out
}

/** 同じ名前は「× n」にまとめて「・」でつなぐ（ノード名は種類名のままなので重なりやすい） */
function countedLabels(labels: string[]): string {
  const c = new Map<string, number>()
  for (const l of labels) c.set(l, (c.get(l) ?? 0) + 1)
  return [...c].map(([l, n]) => (n > 1 ? `${l} × ${n}` : l)).join('・')
}

/** 一括 App として動かせない理由（null = 問題なし、または入口が無い） */
export function appIssueOf(canvas: unknown, groupId: string | null): AppIssue | null {
  return appBatchPlanOf(canvas, groupId)?.issue ?? null
}

export const APP_KIND_LABEL: Record<AppKind, string> = { batch: '撮影後工程', generation: '生成' }
