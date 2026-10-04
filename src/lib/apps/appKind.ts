// App の判定（フェーズ C(c)）: 「App = App モードが組まれたワークフロー」。
// - batch: Batch Input ノードがある撮影後工程のワークフロー（App モード = 写真の投入 → 一括実行 → 結果）
// - generation: グループを App 化した生成ワークフロー（従来の App モード = CapsuleView）
export type AppKind = 'batch' | 'generation'

export interface AppCanvasLike { nodes?: Array<{ type?: string; data?: Record<string, unknown> } | null> | null }

export function appKindOf(canvas: unknown): AppKind | null {
  const nodes = (canvas as AppCanvasLike | null | undefined)?.nodes
  if (!Array.isArray(nodes)) return null
  if (nodes.some((n) => n?.data?.type === 'batchInput')) return 'batch'
  if (nodes.some((n) => n?.type === 'groupNode' && n?.data?.capsuleEnabled === true)) return 'generation'
  return null
}

export const APP_KIND_LABEL: Record<AppKind, string> = { batch: '撮影後工程', generation: '生成' }
