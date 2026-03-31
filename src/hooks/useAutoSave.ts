import { useEffect, useRef } from 'react'
import { useCanvasStore, type AppNode } from '../stores/canvasStore'
import { useWorkflowStore } from '../stores/workflowStore'
import type { Edge } from '@xyflow/react'

const DEBOUNCE_MS = 3000

/**
 * 保存対象のノードプロパティだけを比較する。
 * - position: 値比較（applyNodeChanges が新しいオブジェクトを生成することがある）
 * - data: 参照比較（updateNode は常に新しいオブジェクトを生成するため十分）
 * - ReactFlow 内部管理の measured / selected / dragging / width / height は無視
 */
function nodesContentChanged(prev: AppNode[], curr: AppNode[]): boolean {
  if (prev.length !== curr.length) return true
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i]
    const c = curr[i]
    if (p.id !== c.id || p.type !== c.type || p.data !== c.data) return true
    // position は値比較（参照が変わっても座標が同じならスキップ）
    if (p.position.x !== c.position.x || p.position.y !== c.position.y) return true
    // style は NoteNode のリサイズで変わるため比較（リサイズは保存対象）
    if (p.style !== c.style) return true
  }
  return false
}

/**
 * 保存対象のエッジプロパティだけを比較する。
 * selected / focusable などの ReactFlow 内部プロパティは無視する。
 */
function edgesContentChanged(prev: Edge[], curr: Edge[]): boolean {
  if (prev.length !== curr.length) return true
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i]
    const c = curr[i]
    if (
      p.id !== c.id ||
      p.source !== c.source ||
      p.target !== c.target ||
      p.sourceHandle !== c.sourceHandle ||
      p.targetHandle !== c.targetHandle ||
      p.type !== c.type ||
      p.animated !== c.animated ||
      p.style !== c.style ||
      p.label !== c.label ||
      p.data !== c.data
    ) {
      return true
    }
  }
  return false
}

/**
 * canvasStore の nodes/edges を監視し、変更があれば 3 秒後に自動保存する。
 * ワークフローのロード中（isLoadingWorkflow）はスキップする。
 * ReactFlow 内部の寸法計測・選択状態の変化では保存をトリガーしない。
 */
export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let prevNodes = useCanvasStore.getState().nodes
    let prevEdges = useCanvasStore.getState().edges

    const unsubscribe = useCanvasStore.subscribe(() => {
      const { nodes, edges } = useCanvasStore.getState()

      // 保存対象コンテンツに変化がなければスキップ
      // （ReactFlow の measured / selected 更新などを除外）
      const changed = nodesContentChanged(prevNodes, nodes) || edgesContentChanged(prevEdges, edges)
      prevNodes = nodes
      prevEdges = edges
      if (!changed) return

      const { currentWorkflowId, isSaving, isLoadingWorkflow } = useWorkflowStore.getState()
      if (!currentWorkflowId || isSaving || isLoadingWorkflow) return

      useWorkflowStore.getState().markUnsavedChanges()

      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        useWorkflowStore.getState().saveCurrentWorkflow()
      }, DEBOUNCE_MS)
    })

    return () => {
      unsubscribe()
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])
}
