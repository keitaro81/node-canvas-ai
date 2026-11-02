// Kling の参照一式（2026-11-02 メモ 42・案 B）: 同じ服・人物を正面と別の角度から写した写真を Kling Element ノードにまとめ、
// Kling v3 Pro の Video Generation の「参照一式」ポート（最大 3 つ）につなぐ。プロンプトでは @Element1〜3 で指す。
// 写真はポートでつなぐだけ（Reference Image・Model・Try-On の出力など）。向きの見えない自動判定（autoElementSources）は廃止した。
// 一括処理では使わない（対話実行だけ。計画は注意を出して無視する）
import type { VideoElementRef } from '../ai/types'
import { MAX_ELEMENT_REFS } from '../ai/videoShots'
import { getImageUrlFromNodeData } from '../utils'

/** Kling Element ノードの入力（正面 1 + 別角度 3）。BaseNode のハンドル id は in-image-<id> */
export const KLING_ELEMENT_SLOTS = [
  { id: 'frontal', handle: 'in-image-frontal', label: '正面' },
  { id: 'ref1', handle: 'in-image-ref1', label: '別角度 1' },
  { id: 'ref2', handle: 'in-image-ref2', label: '別角度 2' },
  { id: 'ref3', handle: 'in-image-ref3', label: '別角度 3' },
] as const
export const KLING_ELEMENT_FRONTAL_HANDLE = KLING_ELEMENT_SLOTS[0].handle
export const KLING_ELEMENT_OUTPUT = 'out-element-element'
/** Video Generation の「参照一式」ポート（Kling v3 Pro のときだけ出す）。番号がそのまま @ElementN */
export const VIDEO_GEN_ELEMENT_HANDLES = ['in-element-1', 'in-element-2', 'in-element-3'] as const
export const MAX_VIDEO_ELEMENTS = VIDEO_GEN_ELEMENT_HANDLES.length
export const elementTagOf = (n: number): string => `@Element${n}`
export const elementNumberOfHandle = (handle: string | null | undefined): number | null => {
  const i = VIDEO_GEN_ELEMENT_HANDLES.indexOf((handle ?? '') as (typeof VIDEO_GEN_ELEMENT_HANDLES)[number])
  return i >= 0 ? i + 1 : null
}

interface NodeLike { id: string; type?: string; data?: unknown }
interface EdgeLike { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

/** Kling Element ノードにつないだ写真（正面と別角度の URL）。キャンバスのノードのデータから取る */
export function klingElementImages(nodes: NodeLike[], edges: EdgeLike[], elementNodeId: string): { frontal: string | null; refs: string[] } {
  const urlOf = (handle: string): string | null => {
    const e = edges.find((x) => x.target === elementNodeId && x.targetHandle === handle)
    const src = e ? nodes.find((n) => n.id === e.source) : undefined
    return src ? getImageUrlFromNodeData(src.data, e?.sourceHandle) : null
  }
  const frontal = urlOf(KLING_ELEMENT_FRONTAL_HANDLE)
  const refs = KLING_ELEMENT_SLOTS.slice(1).map((s) => urlOf(s.handle)).filter((u): u is string => !!u && u !== frontal).slice(0, MAX_ELEMENT_REFS)
  return { frontal, refs }
}

export interface VideoGenElements {
  elements: VideoElementRef[]   // 送る参照一式（ポート 1 から順に、続いている分だけ）
  connected: number[]           // つながっているポート番号
  incomplete: number[]          // 正面か別角度が足りない一式の番号（送らない）
  gap: boolean                  // 1 から順につながっていない（例: 2 だけ）
}

/** Video Generation の「参照一式」ポートから、送る参照一式を集める。@ElementN の番号とずれないよう、1 から続いている分だけ送る */
export function videoGenElements(nodes: NodeLike[], edges: EdgeLike[], videoGenId: string): VideoGenElements {
  const connected: number[] = []
  const incomplete: number[] = []
  const byNumber = new Map<number, VideoElementRef | null>()
  VIDEO_GEN_ELEMENT_HANDLES.forEach((handle, i) => {
    const e = edges.find((x) => x.target === videoGenId && x.targetHandle === handle)
    if (!e) return
    const n = i + 1
    connected.push(n)
    const src = nodes.find((x) => x.id === e.source)
    const kind = (src?.data as { type?: string } | undefined)?.type
    const imgs = src && kind === 'klingElement' ? klingElementImages(nodes, edges, src.id) : { frontal: null, refs: [] }
    if (!imgs.frontal || imgs.refs.length === 0) { incomplete.push(n); byNumber.set(n, null); return }
    byNumber.set(n, { frontalUrl: imgs.frontal, referenceUrls: imgs.refs })
  })
  const elements: VideoElementRef[] = []
  for (let n = 1; n <= MAX_VIDEO_ELEMENTS; n++) {
    const el = byNumber.get(n)
    if (!el) break
    elements.push(el)
  }
  const gap = connected.some((n) => n > elements.length + 1) || (connected.length > 0 && !connected.includes(1))
  return { elements, connected, incomplete, gap }
}

/** 「動き」の欄に @ElementN を見える形で入れる（先頭の @Element 行の並びの最後に 1 行で。すでに書いてあれば何もしない） */
export function withElementTag(prompt: string, n: number): string {
  const tag = elementTagOf(n)
  if (prompt.includes(tag)) return prompt
  const lines = prompt.split('\n')
  let at = 0
  while (at < lines.length && /^@Element\d+\s*$/.test(lines[at].trim())) at++
  lines.splice(at, 0, tag)
  return lines.join('\n').replace(/\n+$/, '')
}
