// チャットでワークフローを組む: DSL → キャンバス（テンプレートと同じ形）。種別・ポート・相性を検証し、段ごとに自動配置する。
// 一括処理の入口（Batch Input / Cut Set Input）があれば planTasks の注意も添える（LLM の修正ループと、ユーザーへの表示に使う）
import { catalogNode, multiHandle, portsCompatible, type CatalogPort } from './catalog'
import type { DslWorkflow } from './dsl'
import { inputNodesOf, materializeTurnPresets, planTasks, type SnapshotEdge, type SnapshotNode } from '../batch/plan'
import { TRY_ON_MODEL_HANDLE } from '../tryon/prompt'

export interface CompiledCanvas { nodes: SnapshotNode[]; edges: SnapshotEdge[]; viewport: null }
export interface CompileResult { canvas: CompiledCanvas | null; errors: string[]; notes: string[]; name: string }

const COL_W = 420, X0 = 80, Y0 = 80, GAP = 40
const safeId = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'n'

export function compileWorkflow(wf: DslWorkflow): CompileResult {
  const errors: string[] = []
  const notes: string[] = []
  const name = (wf.name ?? '').trim() || 'チャットで組んだワークフロー'

  // ノード
  const byId = new Map<string, { id: string; type: string; label: string; data: Record<string, unknown>; height: number; catalog: NonNullable<ReturnType<typeof catalogNode>> }>()
  const order: string[] = []
  for (const n of wf.nodes) {
    const c = catalogNode(n.type)
    if (!c) { errors.push(`ノード ${n.id}: 種別 "${n.type}" はありません`); continue }
    let id = safeId(n.id)
    while (byId.has(id)) id = `${id}-2`
    const label = (n.label ?? '').trim() || c.label
    byId.set(n.id, { id, type: n.type, label, data: c.build(label, n.params ?? {}), height: c.height, catalog: c })
    order.push(n.id)
  }
  if (!wf.nodes.length) errors.push('ノードがありません')

  // 辺（"id.port" → 実ハンドル）。複数つなげる入力はつないだ順にスロットを割り当てる
  const edges: SnapshotEdge[] = []
  const slotCount = new Map<string, number>()
  const used = new Set<string>()
  const parseRef = (s: string): { node: string; port: string } | null => { const i = s.lastIndexOf('.'); return i > 0 ? { node: s.slice(0, i), port: s.slice(i + 1) } : null }
  for (const e of wf.edges) {
    const a = parseRef(e.from), b = parseRef(e.to)
    if (!a || !b) { errors.push(`辺 ${e.from} → ${e.to}: "ノードid.ポート名" の形にしてください`); continue }
    const src = byId.get(a.node), dst = byId.get(b.node)
    if (!src) { errors.push(`辺 ${e.from} → ${e.to}: ノード ${a.node} がありません`); continue }
    if (!dst) { errors.push(`辺 ${e.from} → ${e.to}: ノード ${b.node} がありません`); continue }
    const out = src.catalog.outputs.find((p) => p.port === a.port)
    if (!out) { errors.push(`辺 ${e.from} → ${e.to}: ${src.type} に出力ポート "${a.port}" はありません（${src.catalog.outputs.map((p) => p.port).join(' / ') || '出力なし'}）`); continue }
    const inp: CatalogPort | undefined = dst.catalog.inputs.find((p) => p.port === b.port)
    if (!inp) { errors.push(`辺 ${e.from} → ${e.to}: ${dst.type} に入力ポート "${b.port}" はありません（${dst.catalog.inputs.map((p) => p.port).join(' / ') || '入力なし'}）`); continue }
    if (!portsCompatible(out.kind, inp)) { errors.push(`辺 ${e.from} → ${e.to}: ${out.kind} の出力は ${dst.type}.${b.port}（${inp.kind}）につなげません`); continue }
    const key = `${dst.id}|${inp.port}`
    const n = slotCount.get(key) ?? 0
    if (inp.multi ? n >= inp.multi.max : n >= 1) { errors.push(`辺 ${e.from} → ${e.to}: ${dst.type}.${b.port} にはこれ以上つなげません`); continue }
    slotCount.set(key, n + 1)
    const targetHandle = multiHandle(inp, n)
    const id = `e-${src.id}-${out.handle}-${dst.id}-${targetHandle}`
    if (used.has(id)) continue
    used.add(id)
    edges.push({ id, source: src.id, sourceHandle: out.handle, target: dst.id, targetHandle })
  }
  if (errors.length) return { canvas: null, errors, notes, name }

  // 配置: 入力辺を持たないノードを 0 列目、以降は最長経路で列を決め、列の中は出現順に縦に積む
  const depth = new Map<string, number>()
  for (const k of order) depth.set(k, 0)
  const realToKey = new Map([...byId.entries()].map(([k, v]) => [v.id, k]))
  for (let i = 0; i < order.length + 1; i++) {
    let changed = false
    for (const e of edges) {
      const s = realToKey.get(e.source)!, t = realToKey.get(e.target)!
      const d = (depth.get(s) ?? 0) + 1
      if (d > (depth.get(t) ?? 0) && d <= order.length) { depth.set(t, d); changed = true }
    }
    if (!changed) break
  }
  const colY = new Map<number, number>()
  const placed: SnapshotNode[] = order.map((k) => {
    const v = byId.get(k)!
    const col = depth.get(k) ?? 0
    const y = colY.get(col) ?? Y0
    colY.set(col, y + v.height + GAP)
    return { id: v.id, type: v.catalog.rfType, position: { x: X0 + col * COL_W, y }, data: v.data }
  })
  // 始点と終点の向きが違う Video Generation には回転の定型文を「動き」「避けたいこと」に入れる（テンプレートと同じ・トグル廃止）
  const nodes = materializeTurnPresets(placed, edges).nodes.map((n) => (n.data?.type === 'videoGen' ? { ...n, data: { ...n.data, params: { ...n.data.params, autoTurn: false } } } : n))
  const canvas: CompiledCanvas = { nodes, edges, viewport: null }

  // 注意: 一括処理の入口があれば計画の注意を添える。Try-On があればモデルの選択を促す
  const ins = inputNodesOf(canvas)
  if (ins.batchInputId || ins.cutSetInputId) {
    const { tasks, warnings } = planTasks(canvas)
    notes.push(...warnings)
    if (!tasks.length) notes.push('この構成では一括実行の対象になる AI 処理がありません（対話実行で使います）')
  }
  if (nodes.some((n) => n.data?.type === 'libraryModel')) notes.push('モデルは、作ったあとに Model ノードでライブラリのモデルを選んでください（向きごとの出力が Try-On に入ります）')
  for (const n of nodes) {
    if (n.data?.type !== 'tryOn' || edges.some((e) => e.target === n.id && e.targetHandle === TRY_ON_MODEL_HANDLE)) continue
    notes.push(`Try-On（${n.data.label}）のモデル入力に Model ノード（ライブラリのモデル）か参照画像をつないでください`)
  }
  return { canvas, errors, notes, name }
}
