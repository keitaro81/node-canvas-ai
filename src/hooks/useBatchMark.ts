// ノードの「一括: 対象 / 対象外」の印（2026-11-02 段階 4）。理由と内訳は App の「処理内容」に出す（ノードには印だけ）。
// App のグループがあるときはその中だけが対象（外のノードは対象外）。グループが無い既存ワークフローは自分の入口の枝で計画（救済・メモ 24）
import { useMemo } from 'react'
import { useCanvasStore } from '../stores/canvasStore'
import { useLiveCanvas } from './useLiveCanvas'
import { appBatchPlanOf, appScopeOf } from '../lib/apps/appKind'
import { inputNodesOf, planTasksForNode, type WorkflowSnapshot } from '../lib/batch/plan'

export interface BatchMarkInfo { ok: boolean; stage: number }

export function useBatchMark(nodeId: string): BatchMarkInfo | null {
  const live = useLiveCanvas()
  const capsuleGroupId = useCanvasStore((s) => s.capsuleGroupId)
  return useMemo(() => {
    const canvas = { capsuleGroupId, nodes: live.nodes, edges: live.edges }
    const scope = appScopeOf(canvas)
    if (scope.kind !== 'batch') return null   // 一括 App が無い（入口なし・生成 App）: 印は出さない
    if (scope.groupId) {
      const me = live.nodes?.find((n) => n.id === nodeId)
      if (me?.parentId !== scope.groupId) return { ok: false, stage: 0 }   // App のグループの外
      const t = appBatchPlanOf(canvas, scope.groupId)?.tasks.find((x) => x.nodeId === nodeId)
      return t ? { ok: true, stage: t.stage } : { ok: false, stage: 0 }
    }
    const snap = live as unknown as WorkflowSnapshot
    if (!inputNodesOf(snap).batchInputId) return null
    const t = planTasksForNode(snap, nodeId).tasks.find((x) => x.nodeId === nodeId)
    return t ? { ok: true, stage: t.stage } : { ok: false, stage: 0 }
  }, [live, capsuleGroupId, nodeId])
}
