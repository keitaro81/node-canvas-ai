import type { Edge } from '@xyflow/react'
import type { AppNode } from '../../stores/canvasStore'
import type { CapsuleFieldDef, GroupNodeData } from '../../types/nodes'

// ステージとして扱う生成ノードのみ（TextPrompt・ReferenceImage・PromptEnhancerは入力系として扱う）
export type GenerationNodeType = 'imageGen' | 'videoGen'

export type InputNodeType = 'textPrompt' | 'referenceImage' | 'promptEnhancer'

export interface CapsuleInputInfo {
  nodeId: string
  nodeType: InputNodeType
  label: string
}

export interface CapsuleStageInfo {
  nodeId: string
  /** バッチ生成時: このステージに属する全ノードID（nodeId を含む）。1枚の場合は undefined */
  batchNodeIds?: string[]
  nodeType: GenerationNodeType
  label: string
  order: number
  /** editable/visible なフィールド定義 */
  fields: CapsuleFieldDef[]
  /** このステージに直接繋がっている入力ノード */
  stageInputs: CapsuleInputInfo[]
}

// React Flow の node.type で判定（data.type は VideoGen に存在しないため）
const GENERATION_RF_TYPES: Record<string, GenerationNodeType> = {
  imageGenerationNode: 'imageGen',
  videoGenerationNode: 'videoGen',
}

const INPUT_NODE_TYPES: Record<string, InputNodeType> = {
  textPromptNode:     'textPrompt',
  referenceImageNode: 'referenceImage',
  promptEnhancerNode: 'promptEnhancer',
}

// 各入力ノードタイプに対応するCapsule表示可否を判定するフィールドID（promptEnhancerは常時表示）
const INPUT_CAPSULE_FIELD: Record<string, string> = {
  textPromptNode:     'prompt',
  referenceImageNode: 'imageUrl',
}

/** 入力ノードがAppモードで表示対象かどうかを capsuleFields で判定 */
function isInputNodeVisible(node: AppNode): boolean {
  // PromptEnhancerは常にAppパネルに表示
  if (node.type === 'promptEnhancerNode') return true
  const fieldId = INPUT_CAPSULE_FIELD[node.type ?? '']
  if (!fieldId) return false
  const d = node.data as Record<string, unknown>
  const capsuleFields = ((d.capsuleFields ?? {}) as Record<string, { capsuleVisibility?: string }>)
  const visibility = capsuleFields[fieldId]?.capsuleVisibility ?? 'visible'
  return visibility !== 'hidden'
}

function isGenerationNode(node: AppNode): boolean {
  return node.type != null && node.type in GENERATION_RF_TYPES
}

function isInputNode(node: AppNode): boolean {
  return node.type != null && node.type in INPUT_NODE_TYPES
}

/** グループに属するノードを取得 */
export function getGroupChildren(groupId: string, nodes: AppNode[]): AppNode[] {
  return nodes.filter((n) => n.parentId === groupId)
}

/** トポロジカルソートで生成ノードをステージ順に並べる */
export function buildCapsuleStages(
  groupId: string,
  nodes: AppNode[],
  edges: Edge[]
): CapsuleStageInfo[] {
  const children = getGroupChildren(groupId, nodes)
  const genNodes = children.filter(isGenerationNode)
  if (genNodes.length === 0) return []

  const childIds = new Set(children.map((n) => n.id))

  // グループ内エッジのみ（両端がグループ内のノード）
  const internalEdges = edges.filter(
    (e) => childIds.has(e.source) && childIds.has(e.target)
  )

  // 入次数カウント（生成ノード間の依存）
  // 内部接続がないgen nodeも対象に含める（外部からの接続で生成済みのケースをカバー）
  const inDegree: Record<string, number> = {}
  const deps: Record<string, string[]> = {}

  genNodes.forEach((n) => {
    inDegree[n.id] = 0
    deps[n.id] = []
  })

  const genIds = new Set(genNodes.map((n) => n.id))

  internalEdges.forEach((e) => {
    if (genIds.has(e.source) && genIds.has(e.target)) {
      inDegree[e.target] = (inDegree[e.target] ?? 0) + 1
      deps[e.source].push(e.target)
    }
  })

  // Kahnのアルゴリズム（全gen nodeを対象）
  const queue = genNodes.filter((n) => inDegree[n.id] === 0)
  const sorted: AppNode[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(node)
    ;(deps[node.id] ?? []).forEach((nextId) => {
      inDegree[nextId]--
      if (inDegree[nextId] === 0) {
        const nextNode = genNodes.find((n) => n.id === nextId)
        if (nextNode) queue.push(nextNode)
      }
    })
  }

  // 各生成ノードに直接接続されている入力ノードを収集
  // （入力ノード → 生成ノードのエッジを探す）
  function getStageInputs(genNodeId: string): CapsuleInputInfo[] {
    const inputNodeIds = internalEdges
      .filter((e) => e.target === genNodeId)
      .map((e) => e.source)
      .filter((srcId) => {
        const srcNode = children.find((n) => n.id === srcId)
        return srcNode != null && isInputNode(srcNode) && isInputNodeVisible(srcNode)
      })

    return inputNodeIds.map((nodeId) => {
      const n = children.find((c) => c.id === nodeId)!
      const d = n.data as Record<string, unknown>
      return {
        nodeId,
        nodeType: INPUT_NODE_TYPES[n.type!],
        label: (d.label as string) ?? (n.type === 'textPromptNode' ? 'テキスト' : '参照画像'),
      }
    })
  }

  function buildStageInfo(node: AppNode, order: number, batchNodeIds?: string[]): CapsuleStageInfo {
    const d = node.data as Record<string, unknown>
    const capsuleFields = (d.capsuleFields ?? {}) as Record<string, CapsuleFieldDef>
    const fields = Object.values(capsuleFields).filter((f) => f.capsuleVisibility !== 'hidden')
    fields.sort((a, b) => (a.capsuleOrder ?? 99) - (b.capsuleOrder ?? 99))
    return {
      nodeId: node.id,
      ...(batchNodeIds && batchNodeIds.length > 1 ? { batchNodeIds } : {}),
      nodeType: GENERATION_RF_TYPES[node.type!] ?? 'imageGen',
      label: (d.label as string) ?? 'Stage',
      order,
      fields,
      stageInputs: getStageInputs(node.id),
    }
  }

  // batchId が同じノードをまとめて1ステージに集約する
  const seenBatches = new Set<string>()
  const resultStages: CapsuleStageInfo[] = []

  for (const node of sorted) {
    const d = node.data as Record<string, unknown>
    const batchId = ((d.params as Record<string, unknown> | undefined)?.batchId) as string | undefined

    if (batchId) {
      if (seenBatches.has(batchId)) continue  // 既処理のバッチは skip
      seenBatches.add(batchId)
      const batchNodes = sorted.filter((n) => {
        const nd = n.data as Record<string, unknown>
        return ((nd.params as Record<string, unknown> | undefined)?.batchId) === batchId
      })
      resultStages.push(buildStageInfo(batchNodes[0], resultStages.length, batchNodes.map((n) => n.id)))
    } else {
      resultStages.push(buildStageInfo(node, resultStages.length))
    }
  }

  return resultStages
}

/** グループ内に並列実行される生成ノードが存在するか判定 */
export function hasParallelGenerationNodes(
  groupId: string,
  nodes: AppNode[],
  edges: Edge[]
): boolean {
  const children = getGroupChildren(groupId, nodes)
  const genNodes = children.filter(isGenerationNode)
  if (genNodes.length <= 1) return false

  const childIds = new Set(children.map((n) => n.id))
  const internalEdges = edges.filter(
    (e) => childIds.has(e.source) && childIds.has(e.target)
  )

  const inDegree: Record<string, number> = {}
  const deps: Record<string, string[]> = {}
  genNodes.forEach((n) => {
    inDegree[n.id] = 0
    deps[n.id] = []
  })
  const genIds = new Set(genNodes.map((n) => n.id))
  internalEdges.forEach((e) => {
    if (genIds.has(e.source) && genIds.has(e.target)) {
      inDegree[e.target] = (inDegree[e.target] ?? 0) + 1
      deps[e.source].push(e.target)
    }
  })

  // Kahnのキューに2つ以上入った瞬間 = 並列
  const queue = genNodes.filter((n) => inDegree[n.id] === 0)
  if (queue.length > 1) return true

  while (queue.length > 0) {
    const node = queue.shift()!
    for (const nextId of deps[node.id] ?? []) {
      inDegree[nextId]--
      if (inDegree[nextId] === 0) {
        queue.push(genNodes.find((n) => n.id === nextId)!)
      }
    }
    if (queue.length > 1) return true
  }
  return false
}

/**
 * グローバル入力ノード（どのステージにも直接繋がっていない TextPrompt / ReferenceImage）を返す。
 * 特定ステージに繋がっているものはそのステージの stageInputs に含めるため除外。
 */
export function buildCapsuleInputNodes(
  groupId: string,
  nodes: AppNode[],
  edges: Edge[],
  stages: CapsuleStageInfo[]
): CapsuleInputInfo[] {
  const children = getGroupChildren(groupId, nodes)
  const childIds = new Set(children.map((n) => n.id))

  // グループ内エッジに1本も繋がっていない入力ノードは除外
  const internalEdges = edges.filter(
    (e) => childIds.has(e.source) && childIds.has(e.target)
  )
  const connectedNodeIds = new Set(internalEdges.flatMap((e) => [e.source, e.target]))

  // ステージに既に割り当て済みの入力ノードID
  const assignedInputIds = new Set(
    stages.flatMap((s) => s.stageInputs.map((si) => si.nodeId))
  )

  return children
    .filter(
      (n) =>
        n.type != null &&
        n.type in INPUT_NODE_TYPES &&
        !assignedInputIds.has(n.id) &&
        connectedNodeIds.has(n.id) &&
        isInputNodeVisible(n)
    )
    .map((n) => {
      const d = n.data as Record<string, unknown>
      return {
        nodeId: n.id,
        nodeType: INPUT_NODE_TYPES[n.type!],
        label: (d.label as string) ?? (n.type === 'textPromptNode' ? 'テキスト' : '参照画像'),
      }
    })
}

/** Capsuleビューに表示するグループを取得 */
export function getActiveCapsuleGroup(
  capsuleGroupId: string | null,
  nodes: AppNode[]
): { node: AppNode; data: GroupNodeData } | null {
  if (!capsuleGroupId) return null
  const node = nodes.find((n) => n.id === capsuleGroupId && n.type === 'groupNode')
  if (!node) return null
  return { node, data: node.data as unknown as GroupNodeData }
}
