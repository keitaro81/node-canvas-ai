import type { Edge } from '@xyflow/react'
import type { AppNode } from '../../stores/canvasStore'
import type { CapsuleFieldDef, GroupNodeData } from '../../types/nodes'

// ステージとして扱うノード（TextPrompt・ReferenceImage・ReferenceVideo・PromptEnhancer・Model は入力系として扱う）
// tryOn = Try-On（2026-11-08 メモ 78: 画像生成 → 試着の App で、前のステージの結果から「次のステージで使用」で服を選ぶ）
export type GenerationNodeType = 'imageGen' | 'videoGen' | 'tryOn'

// referenceVideo = 参照動画（Video Generation の参照動画の入れ替え・2026-11-08 メモ 69）
// libraryModel = Model ノード（Try-On のモデル。App の欄でライブラリのモデルを選ぶ・2026-11-08 メモ 78）
export type InputNodeType = 'textPrompt' | 'referenceImage' | 'referenceVideo' | 'promptEnhancer' | 'libraryModel'

export interface CapsuleInputInfo {
  nodeId: string
  nodeType: InputNodeType
  label: string
}

export interface CapsuleStageInfo {
  nodeId: string
  /** 接続済みの ImageDisplay / VideoDisplay ノード ID リスト。App右パネルの表示に使用 */
  displayNodeIds?: string[]
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
  tryOnNode: 'tryOn',
}
/** App 化の可否（並列の判定）に数える生成ノードは従来どおり画像・動画の生成だけ。Try-On まで数えると、Model から Try-On を 2 つ並べた既存の App が「並列」で解除されてしまう */
const PARALLEL_CHECK_RF_TYPES = new Set(['imageGenerationNode', 'videoGenerationNode'])

const INPUT_NODE_TYPES: Record<string, InputNodeType> = {
  textPromptNode:     'textPrompt',
  referenceImageNode: 'referenceImage',
  referenceVideoNode: 'referenceVideo',
  promptEnhancerNode: 'promptEnhancer',
  libraryModelNode:   'libraryModel',
}

// 各入力ノードタイプに対応するCapsule表示可否を判定するフィールドID（promptEnhancerは常時表示）
const INPUT_CAPSULE_FIELD: Record<string, string> = {
  textPromptNode:     'prompt',
  referenceImageNode: 'imageUrl',
  referenceVideoNode: 'videoUrl',
}

/** 入力ノードの既定の表示名（ノードに名前が無いとき） */
const inputDefaultLabel = (type: string | undefined): string => (type === 'textPromptNode' ? 'テキスト' : type === 'referenceVideoNode' ? '参照動画' : type === 'libraryModelNode' ? 'モデル' : '参照画像')

/** 入力ノードがAppモードで表示対象かどうかを capsuleFields で判定 */
function isInputNodeVisible(node: AppNode): boolean {
  // PromptEnhancer と Model は常に App の欄に出す（Model はライブラリのモデルを選ぶ欄・2026-11-08 メモ 78）
  if (node.type === 'promptEnhancerNode' || node.type === 'libraryModelNode') return true
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

  // 入次数・依存関係をBFSで解決（DisplayNode等の非生成ノードを透過して検出）
  const { inDegree, deps } = buildGenDependencies(genNodes, children, internalEdges)

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
        label: (d.label as string) ?? inputDefaultLabel(n.type),
      }
    })
  }

  // この GenNode に接続された DisplayNode を検索（グループ外も対象）
  function getDisplayNodeIds(genNodeId: string): string[] {
    return edges
      .filter(
        (e) =>
          e.source === genNodeId &&
          (e.sourceHandle === 'out-image-image-out' || e.sourceHandle === 'out-video')
      )
      .map((e) => e.target)
      .filter((tid) => {
        const n = nodes.find((nd) => nd.id === tid)
        return n?.type === 'imageDisplayNode' || n?.type === 'videoDisplayNode'
      })
  }

  function buildStageInfo(node: AppNode, order: number): CapsuleStageInfo {
    const d = node.data as Record<string, unknown>
    const capsuleFields = (d.capsuleFields ?? {}) as Record<string, CapsuleFieldDef>
    const fields = Object.values(capsuleFields).filter((f) => f.capsuleVisibility !== 'hidden')
    fields.sort((a, b) => (a.capsuleOrder ?? 99) - (b.capsuleOrder ?? 99))
    const displayNodeIds = getDisplayNodeIds(node.id)
    return {
      nodeId: node.id,
      ...(displayNodeIds.length > 0 ? { displayNodeIds } : {}),
      nodeType: GENERATION_RF_TYPES[node.type!] ?? 'imageGen',
      label: (d.label as string) ?? 'Stage',
      order,
      fields,
      stageInputs: getStageInputs(node.id),
    }
  }

  return sorted.map((node, i) => buildStageInfo(node, i))
}

/**
 * 生成ノード間の依存関係を、非生成ノードを透過して求める。
 * 例: ImageGenNode → ImageDisplayNode → VideoGenNode の場合、
 * ImageGenNode が VideoGenNode に依存していることを正しく検出する。
 */
function buildGenDependencies(
  genNodes: AppNode[],
  children: AppNode[],
  internalEdges: Edge[]
): { inDegree: Record<string, number>; deps: Record<string, string[]> } {
  const genIds = new Set(genNodes.map((n) => n.id))

  // グループ内全ノードの隣接リストを構築
  const adj: Record<string, string[]> = {}
  children.forEach((n) => { adj[n.id] = [] })
  internalEdges.forEach((e) => {
    if (adj[e.source] !== undefined) adj[e.source].push(e.target)
  })

  const inDegree: Record<string, number> = {}
  const deps: Record<string, string[]> = {}
  genNodes.forEach((n) => { inDegree[n.id] = 0; deps[n.id] = [] })

  // 各生成ノードから BFS し、非生成ノードを透過して最初に到達する生成ノードを「直接依存先」とする
  genNodes.forEach((start) => {
    const queue = [...(adj[start.id] ?? [])]
    const visited = new Set<string>([start.id])

    while (queue.length > 0) {
      const cur = queue.shift()!
      if (visited.has(cur)) continue
      visited.add(cur)

      if (genIds.has(cur)) {
        // 生成ノードに到達 → 直接依存として登録（それより先は辿らない）
        deps[start.id].push(cur)
        inDegree[cur]++
      } else {
        // 非生成ノードは透過して辿り続ける
        for (const next of adj[cur] ?? []) {
          if (!visited.has(next)) queue.push(next)
        }
      }
    }
  })

  return { inDegree, deps }
}

/** グループ内に並列実行される生成ノードが存在するか判定 */
export function hasParallelGenerationNodes(
  groupId: string,
  nodes: AppNode[],
  edges: Edge[]
): boolean {
  const children = getGroupChildren(groupId, nodes)
  const genNodes = children.filter((n) => n.type != null && PARALLEL_CHECK_RF_TYPES.has(n.type))
  if (genNodes.length <= 1) return false

  const childIds = new Set(children.map((n) => n.id))
  const internalEdges = edges.filter(
    (e) => childIds.has(e.source) && childIds.has(e.target)
  )

  const { inDegree, deps } = buildGenDependencies(genNodes, children, internalEdges)

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

  // ListNode のスロット（in-image-* / in-text-* / in-video-*）に接続済みのノードID
  // → グローバル入力として全ステージに表示させない（各ステージの ListNode パネルで表示される）
  const listSlotNodeIds = new Set(
    internalEdges
      .filter((e) => {
        const target = children.find((n) => n.id === e.target)
        return (
          target?.type === 'listNode' &&
          (e.targetHandle?.startsWith('in-image-') || e.targetHandle?.startsWith('in-text-') || e.targetHandle?.startsWith('in-video-'))
        )
      })
      .map((e) => e.source)
  )

  return children
    .filter(
      (n) =>
        n.type != null &&
        n.type in INPUT_NODE_TYPES &&
        !assignedInputIds.has(n.id) &&
        !listSlotNodeIds.has(n.id) &&
        connectedNodeIds.has(n.id) &&
        isInputNodeVisible(n)
    )
    .map((n) => {
      const d = n.data as Record<string, unknown>
      return {
        nodeId: n.id,
        nodeType: INPUT_NODE_TYPES[n.type!],
        label: (d.label as string) ?? inputDefaultLabel(n.type),
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

// ────────────────────────────────────────────
// 次のステージへの線（2026-11-08 メモ 78）
// 「前のステージの結果の画像を選ぶ」= 次のステージへの線の出どころを、選んだ結果ノードに付け替える。
// チャットで組んだ直後はステージのノード自体（Image Generation など）から次のステージへ線が付いていて、
// そのままでは次のステージに画像が渡らない（Image Generation は結果を自分では持たない）ので、その線も対象にする
// ────────────────────────────────────────────
export interface DownstreamLink {
  /** いまの出どころ: 結果ノード（選択済み）か、ステージのノード自体（まだ選んでいない） */
  sourceId: string
  /** つなぎ先のステージのノード */
  genNodeId: string
  targetHandle: string
}

export function isStageNodeType(type: string | null | undefined): boolean {
  return type != null && type in GENERATION_RF_TYPES
}

const STAGE_OUTPUT_HANDLES = new Set(['out-image-image-out', 'out-video'])

/** ステージの結果ノード（か、ステージのノード自体の出力）から、他のステージへつながる線 */
export function downstreamLinksOf(stage: Pick<CapsuleStageInfo, 'nodeId' | 'displayNodeIds'>, nodes: AppNode[], edges: Edge[]): DownstreamLink[] {
  const displayIds = new Set(stage.displayNodeIds ?? [])
  return edges
    .filter((e) => displayIds.has(e.source) || (e.source === stage.nodeId && STAGE_OUTPUT_HANDLES.has(e.sourceHandle ?? '')))
    .filter((e) => isStageNodeType(nodes.find((n) => n.id === e.target)?.type))
    .map((e) => ({ sourceId: e.source, genNodeId: e.target, targetHandle: e.targetHandle ?? 'in-image' }))
}

/** 選んだ結果ノードに次のステージへの線を付け替えた辺の一覧（同じ先・同じ入力の線は 1 本に） */
export function rewireDownstream(displayNodeId: string, stage: Pick<CapsuleStageInfo, 'nodeId' | 'displayNodeIds'>, links: DownstreamLink[], nodes: AppNode[], edges: Edge[]): Edge[] {
  if (!links.length) return edges
  const sourceIds = new Set([...(stage.displayNodeIds ?? []), stage.nodeId])
  const genIds = new Set(links.map((l) => l.genNodeId))
  const kept = edges.filter((e) => !(sourceIds.has(e.source) && genIds.has(e.target)))
  const display = nodes.find((n) => n.id === displayNodeId)
  const sourceHandle = display?.type === 'videoDisplayNode' ? 'out-video' : 'out-image-image-out'
  const seen = new Set<string>()
  const added: Edge[] = []
  for (const l of links) {
    const key = `${l.genNodeId}|${l.targetHandle}`
    if (seen.has(key)) continue
    seen.add(key)
    added.push({ id: `e-disp-${displayNodeId}-${l.genNodeId}-${l.targetHandle}`, source: displayNodeId, sourceHandle, target: l.genNodeId, targetHandle: l.targetHandle, style: { stroke: '#8B5CF6', strokeWidth: 2 }, animated: false, className: '' })
  }
  return [...kept, ...added]
}
