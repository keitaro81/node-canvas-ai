// 線のドラッグ中のポート判定（2026-11-01 メモ 31）。表示は PortLabel.tsx: ノードにマウスを載せたとき、または線をドラッグ中に「つなげる候補」のポートに名前を出す。
// 線のドラッグ中は、出し元と種類が合うポートだけ名前を出し、合わないポートは薄くする（どこにつなげるかが分かるように）。
import { useConnection } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { isCompatibleFor } from '../../stores/canvasStore'
import type { PortType } from '../../types/nodes'

/** ハンドル id（out-image-xxx / in-text / in-image-end …）から種類 */
export const portTypeOfHandle = (id: string | null | undefined): PortType => (((id ?? '').split('-')[1] || 'text') as PortType)

export interface DragTarget {
  active: boolean                                   // 線をドラッグ中（このノード以外が出し元）
  inputOk: (handleId: string) => boolean            // この入力ポートがつなげる候補か（出力から引いているとき）
  outputOk: (handleId: string) => boolean           // この出力ポートがつなげる候補か（入力から逆向きに引いているとき）
}

/** 線のドラッグ状態をこのノードの立場で見る。選択子は文字列にして、ドラッグ中のマウス移動で全ノードが描き直されないようにする */
export function useDragTarget(nodeId: string, nodeType: string | undefined): DragTarget {
  const key = useConnection((c) => (c.inProgress ? `${c.fromNode?.id ?? ''}|${c.fromNode?.type ?? ''}|${c.fromHandle?.id ?? ''}|${c.fromHandle?.type ?? ''}` : ''))
  const [fromNodeId, fromNodeType, fromHandleId, fromHandleType] = key ? key.split('|') : ['', '', '', '']
  const active = !!key && fromNodeId !== nodeId
  const src = portTypeOfHandle(fromHandleId)
  return {
    active,
    inputOk: (handleId) => active && fromHandleType === 'source' && isCompatibleFor(src, portTypeOfHandle(handleId), nodeType),
    outputOk: (handleId) => active && fromHandleType === 'target' && isCompatibleFor(portTypeOfHandle(handleId), src, fromNodeType || undefined),
  }
}

/** ドラッグ中、候補でないポートは薄くする */
export const dimIfNotTarget = (drag: DragTarget, ok: boolean): CSSProperties => (drag.active && !ok ? { opacity: 0.3 } : {})
