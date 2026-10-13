// 商品動画（Kling 3.0 Pro）向けの純関数: カット → elements、ショット列 → multi_prompt。ノードと App（将来）で共用
import type { VideoElementRef, VideoShot } from './types'

export const MAX_ELEMENT_REFS = 3          // Kling: frontal 1 + reference 1〜3
export const SHOT_MIN = 1, SHOT_MAX = 15   // multi_prompt の 1 ショット
export const TOTAL_MIN = 3, TOTAL_MAX = 15 // 動画全体

export interface CutImage { nodeId: string; url: string }

/** つないだカットを 1 つのエレメントにまとめる。正面 = frontalNodeId のカット（無ければ先頭）、残りは別角度（最大 3）。溢れた枚数も返す */
export function cutsToElement(cuts: CutImage[], frontalNodeId?: string | null): { element: VideoElementRef | null; ignored: number } {
  const valid = cuts.filter((c) => !!c.url)
  if (valid.length === 0) return { element: null, ignored: 0 }
  const frontal = valid.find((c) => c.nodeId === frontalNodeId) ?? valid[0]
  const refs = valid.filter((c) => c !== frontal && c.url !== frontal.url).map((c) => c.url)
  const unique = Array.from(new Set(refs))
  return { element: { frontalUrl: frontal.url, referenceUrls: unique.slice(0, MAX_ELEMENT_REFS) }, ignored: Math.max(0, unique.length - MAX_ELEMENT_REFS) }
}

/** API の elements 形に変換（空のエレメントは落とす） */
export function buildKlingElements(elements: VideoElementRef[] | undefined): Array<{ frontal_image_url: string; reference_image_urls?: string[] }> {
  return (elements ?? [])
    .filter((e) => !!e.frontalUrl)
    .map((e) => {
      const refs = Array.from(new Set(e.referenceUrls.filter((u) => !!u && u !== e.frontalUrl))).slice(0, MAX_ELEMENT_REFS)
      return refs.length ? { frontal_image_url: e.frontalUrl, reference_image_urls: refs } : { frontal_image_url: e.frontalUrl }
    })
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

/** ショット列 → multi_prompt と全体の duration。共通プロンプト（basePrompt）は各ショットの先頭に付ける */
export function buildMultiPrompt(shots: VideoShot[] | undefined, basePrompt?: string | null): { multi_prompt: Array<{ prompt: string; duration: string }>; duration: string } | null {
  const rows = (shots ?? []).filter((s) => s.prompt.trim() !== '')
  if (rows.length === 0) return null
  const base = (basePrompt ?? '').trim()
  const multi_prompt = rows.map((s) => ({ prompt: base ? `${base}\n${s.prompt.trim()}` : s.prompt.trim(), duration: String(clamp(s.duration || 5, SHOT_MIN, SHOT_MAX)) }))
  const total = multi_prompt.reduce((sum, s) => sum + Number(s.duration), 0)
  return { multi_prompt, duration: String(clamp(total, TOTAL_MIN, TOTAL_MAX)) }
}

/** ショット列の合計秒数（表示用） */
export function shotsTotalSeconds(shots: VideoShot[] | undefined): number {
  return (shots ?? []).reduce((s, x) => s + clamp(x.duration || 5, SHOT_MIN, SHOT_MAX), 0)
}
