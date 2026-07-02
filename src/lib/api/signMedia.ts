import { signMediaRequest, toCanonicalRef } from './storage'

// canvas_data ノード data に保存され得るメディアURLフィールド。
// 重要: api/storage/sign-media.ts の collectCanvasMedia ・ api/cron/cleanup-orphan-storage.ts と一致させること。
const TOP_LEVEL_URL_FIELDS = ['output', 'videoUrl', 'imageUrl', 'uploadedImagePreview', 'maskUrl'] as const
const PARAM_URL_FIELDS = ['imageUrl', 'maskUrl'] as const

type NodeLike = { data?: unknown }

function asData(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/** ノード data の全メディアURLフィールドを fn で写像する（変化が無ければ元オブジェクトを返す）。 */
function mapNodeUrls(data: unknown, fn: (v: string) => string): unknown {
  const d = asData(data)
  if (!d) return data
  let changed = false
  const next: Record<string, unknown> = { ...d }
  for (const f of TOP_LEVEL_URL_FIELDS) {
    const v = next[f]
    if (typeof v === 'string' && v) {
      const nv = fn(v)
      if (nv !== v) { next[f] = nv; changed = true }
    }
  }
  const params = asData(next.params)
  if (params) {
    const p: Record<string, unknown> = { ...params }
    let pChanged = false
    for (const f of PARAM_URL_FIELDS) {
      const v = p[f]
      if (typeof v === 'string' && v) {
        const nv = fn(v)
        if (nv !== v) { p[f] = nv; pChanged = true }
      }
    }
    if (pChanged) { next.params = p; changed = true }
  }
  return changed ? next : data
}

/**
 * canvas ノード配列の全メディアURLフィールドを署名URL化（読込口）。
 * L2: サーバー（sign-media, Mode workflowId）がワークフローアクセスを認可し、その canvas のメディアを署名する。
 * workflowId が無ければ署名しない（＝未保存/コンテキスト無し）。
 */
export async function signCanvasNodes<T extends NodeLike>(nodes: T[], workflowId: string | null | undefined): Promise<T[]> {
  if (!workflowId) return nodes
  const map = await signMediaRequest({ workflowId })
  if (!Object.keys(map).length) return nodes
  return nodes.map((n) => ({ ...n, data: mapNodeUrls(n.data, (v) => map[v] ?? v) }) as T)
}

/** canvas ノード配列の全メディアURLフィールドを canonical へ正規化（書込口・署名URLを保存しない）。 */
export function canonicalizeCanvasNodes<T extends NodeLike>(nodes: T[]): T[] {
  return nodes.map((n) => ({ ...n, data: mapNodeUrls(n.data, (v) => (toCanonicalRef(v) ?? v) as string) }) as T)
}

/** generations 行配列の output_url を署名URL化（読込口・Mode urls）。 */
export async function signGenerationRows<T extends { output_url: string | null }>(rows: T[]): Promise<T[]> {
  const map = await signMediaRequest({ urls: rows.map((r) => r.output_url) })
  if (!Object.keys(map).length) return rows
  return rows.map((r) => (r.output_url && map[r.output_url] ? { ...r, output_url: map[r.output_url] } : r))
}

/** workflow 行配列の thumbnail_url を署名URL化（読込口・カード表示用・Mode urls）。 */
export async function signWorkflowThumbnails<T extends { thumbnail_url: string | null }>(rows: T[]): Promise<T[]> {
  const map = await signMediaRequest({ urls: rows.map((r) => r.thumbnail_url) })
  if (!Object.keys(map).length) return rows
  return rows.map((r) => (r.thumbnail_url && map[r.thumbnail_url] ? { ...r, thumbnail_url: map[r.thumbnail_url] } : r))
}

/** workflowId→URL の Record の値を署名URL化（ProjectsPage サムネのフォールバック・Mode urls）。 */
export async function signUrlRecord(rec: Record<string, string>): Promise<Record<string, string>> {
  const map = await signMediaRequest({ urls: Object.values(rec) })
  if (!Object.keys(map).length) return rec
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(rec)) out[k] = map[v] ?? v
  return out
}
