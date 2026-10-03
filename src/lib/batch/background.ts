// Product Layout の背景入力の出どころ（仕様 3-3「背景画像」・4-2「ジョブごと」）。
// 対話実行（ノード）・一括実行の計画（api/batch）・確認グリッド（Jobs）で同じ解決を使う純関数。
//
// 背景入力（in-image-background）につながるノード S は次のどれか:
//   - Image Generation ノード（直結）                → 生成器 G = S
//   - Image Display ノード（Image Generation の結果） → 生成器 G = S に out-image-image-out でつながる Image Generation
//   - それ以外（参照画像など）                        → 生成器なし（固定の背景画像）

export interface BgNode { id: string; type?: string; data?: Record<string, unknown> | undefined }
export interface BgEdge { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }
export interface BgCanvas { nodes?: BgNode[]; edges?: BgEdge[] }

export const LAYOUT_BACKGROUND_HANDLE = 'in-image-background'
export const IMAGE_GEN_OUTPUT_HANDLE = 'out-image-image-out'
export const IMAGE_GEN_TEXT_HANDLES = ['in-text', 'in-text-prompt']

export interface BackgroundSource {
  layoutNodeId: string
  sourceNodeId: string              // 背景入力につながるノード
  generatorNodeId: string | null    // 背景を生成する Image Generation（無ければ固定画像）
}

const nodesOf = (c: BgCanvas | null | undefined): BgNode[] => (Array.isArray(c?.nodes) ? c!.nodes! : [])
const edgesOf = (c: BgCanvas | null | undefined): BgEdge[] => (Array.isArray(c?.edges) ? c!.edges! : [])
const typeOf = (n: BgNode | undefined): string | undefined => (n?.data?.type as string | undefined)

/** あるレイアウトノードの背景の出どころ。背景入力が無ければ null */
export function resolveBackgroundSource(canvas: BgCanvas | null | undefined, layoutNodeId: string): BackgroundSource | null {
  const nodes = nodesOf(canvas), edges = edgesOf(canvas)
  const bgEdge = edges.find((e) => e.target === layoutNodeId && e.targetHandle === LAYOUT_BACKGROUND_HANDLE)
  if (!bgEdge) return null
  const src = nodes.find((n) => n.id === bgEdge.source)
  if (!src) return null
  if (typeOf(src) === 'imageGen') return { layoutNodeId, sourceNodeId: src.id, generatorNodeId: src.id }
  if (typeOf(src) === 'imageDisplay') {
    const feed = edges.find((e) => e.target === src.id && typeOf(nodes.find((n) => n.id === e.source)) === 'imageGen')
    return { layoutNodeId, sourceNodeId: src.id, generatorNodeId: feed?.source ?? null }
  }
  return { layoutNodeId, sourceNodeId: src.id, generatorNodeId: null }
}

/** 背景の種類が「画像」の全レイアウトノードの出どころ */
export function backgroundSourcesOf(canvas: BgCanvas | null | undefined): BackgroundSource[] {
  return nodesOf(canvas)
    .filter((n) => typeOf(n) === 'productLayout' && (n.data?.params as { backgroundKind?: string } | undefined)?.backgroundKind === 'image')
    .map((n) => resolveBackgroundSource(canvas, n.id))
    .filter((s): s is BackgroundSource => !!s)
}

/** Image Generation ノードのプロンプト（上流のテキストノードをつないだもの。無ければ params.prompt） */
export function promptForGenerator(canvas: BgCanvas | null | undefined, generatorNodeId: string): string {
  const nodes = nodesOf(canvas), edges = edgesOf(canvas)
  const texts = edges
    .filter((e) => e.target === generatorNodeId && IMAGE_GEN_TEXT_HANDLES.includes(e.targetHandle ?? ''))
    .map((e) => {
      const d = nodes.find((n) => n.id === e.source)?.data
      const p = (d?.params as { prompt?: unknown } | undefined)?.prompt
      if (typeof p === 'string' && p.trim()) return p.trim()
      const out = d?.outputText
      return typeof out === 'string' && out.trim() ? out.trim() : null
    })
    .filter((t): t is string => !!t)
  if (texts.length) return texts.join('\n\n')
  const own = (nodes.find((n) => n.id === generatorNodeId)?.data?.params as { prompt?: unknown } | undefined)?.prompt
  return typeof own === 'string' ? own.trim() : ''
}

/** 対話実行での背景画像 URL。生成器なら結果ノード（Image Display）の出力、固定画像なら S 自身の画像 */
export function interactiveBackgroundUrl(canvas: BgCanvas | null | undefined, layoutNodeId: string, imageUrlOf: (data: Record<string, unknown> | undefined) => string | null): string | null {
  const s = resolveBackgroundSource(canvas, layoutNodeId)
  if (!s) return null
  const nodes = nodesOf(canvas), edges = edgesOf(canvas)
  const src = nodes.find((n) => n.id === s.sourceNodeId)
  if (typeOf(src) !== 'imageGen') return imageUrlOf(src?.data)
  // Image Generation 直結: その結果ノードのうち画像を持つ最後のもの
  const outputs = edges
    .filter((e) => e.source === s.sourceNodeId && e.sourceHandle === IMAGE_GEN_OUTPUT_HANDLE)
    .map((e) => imageUrlOf(nodes.find((n) => n.id === e.target)?.data))
    .filter((u): u is string => !!u)
  return outputs[outputs.length - 1] ?? null
}
