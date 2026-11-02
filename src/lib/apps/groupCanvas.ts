// テンプレート・チャットで組んだノードを、最初からグループに入れて App 化した形にする（2026-11-02・一括処理と App の再設計 §1）。
// 大きさはキャンバスの手動グループ化（Canvas.tsx groupSelectedNodes）と同じ余白。ノードの高さは種類ごとの見積り（agent/catalog）
import { catalogNode } from '../agent/catalog'
import type { SnapshotEdge, SnapshotNode } from '../batch/plan'

export const APP_GROUP_ID = 'app-group'
const PADDING = 40, HEADER = 28, NODE_W = 280, DEFAULT_H = 400

export type GroupedNode = SnapshotNode & { parentId?: string; extent?: 'parent'; style?: { width: number; height: number } }
export interface GroupedCanvas { nodes: GroupedNode[]; edges: SnapshotEdge[]; viewport: null; capsuleGroupId: string | null }

/** ノード全体を 1 つのグループに入れて App 化する（グループ無しなら capsuleGroupId は null）。子の位置はグループからの相対位置に直す */
export function wrapInAppGroup(canvas: { nodes: SnapshotNode[]; edges: SnapshotEdge[] }, label = 'Group'): GroupedCanvas {
  const children = canvas.nodes.filter((n) => n.type !== 'groupNode')
  if (!children.length) return { nodes: canvas.nodes, edges: canvas.edges, viewport: null, capsuleGroupId: null }
  let id = APP_GROUP_ID
  while (canvas.nodes.some((n) => n.id === id)) id = `${id}-2`
  const x = (n: SnapshotNode) => n.position?.x ?? 0
  const y = (n: SnapshotNode) => n.position?.y ?? 0
  const h = (n: SnapshotNode) => catalogNode(String(n.data?.type ?? ''))?.height ?? DEFAULT_H
  const minX = Math.min(...children.map(x)) - PADDING
  const minY = Math.min(...children.map(y)) - PADDING - HEADER
  const maxX = Math.max(...children.map((n) => x(n) + NODE_W)) + PADDING
  const maxY = Math.max(...children.map((n) => y(n) + h(n))) + PADDING
  const group: GroupedNode = { id, type: 'groupNode', position: { x: minX, y: minY }, style: { width: maxX - minX, height: maxY - minY }, data: { label, capsuleEnabled: true } }
  const nodes: GroupedNode[] = [group, ...children.map((n): GroupedNode => ({ ...n, parentId: id, extent: 'parent', position: { x: x(n) - minX, y: y(n) - minY } }))]
  return { nodes, edges: canvas.edges, viewport: null, capsuleGroupId: id }
}
