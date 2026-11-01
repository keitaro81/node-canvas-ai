// App の判定（2026-11-02・一括処理と App の再設計 段階 3）: App = App 化したグループ。グループの中身で種類が決まる。
// - グループの中に入口（Batch Input）が 1 つ → batch（一括 App。範囲はグループの中だけ）
// - 入口が無い → generation（従来の App モード = CapsuleView）
// - 入口が 2 つ以上 → batch だが entryId が無い（App 側で「入口は 1 つに」と案内し、一括 App としては動かない）
// - 救済: App 化したグループが無い既存ワークフローは、Batch Input があればキャンバス全体を 1 つの一括 App とみなす
// （2026-11-01: 商品動画（Cut Set Input / 旧 Product Video）の App は廃止）
export type AppKind = 'batch' | 'generation'

export interface AppCanvasLike {
  capsuleGroupId?: string | null
  nodes?: Array<{ id?: string; type?: string; parentId?: string; data?: Record<string, unknown> } | null> | null
}
export interface AppScope { kind: AppKind | null; groupId: string | null; entryId: string | null; entryCount: number }

const NONE: AppScope = { kind: null, groupId: null, entryId: null, entryCount: 0 }
const isEntry = (n: { data?: Record<string, unknown> } | null | undefined) => n?.data?.type === 'batchInput'

export function appScopeOf(canvas: unknown): AppScope {
  const c = canvas as AppCanvasLike | null | undefined
  if (!Array.isArray(c?.nodes)) return NONE
  const nodes = c!.nodes!.filter((n): n is NonNullable<typeof n> => !!n)
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

export const APP_KIND_LABEL: Record<AppKind, string> = { batch: '撮影後工程', generation: '生成' }
