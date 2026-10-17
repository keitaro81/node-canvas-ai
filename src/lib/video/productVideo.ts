// 商品訴求動画（EC 向け）の共通定義: カットの役割・ショット構成テンプレート・Product Video ノードの設定と、
// サーバー（api/batch）とクライアント（ノード / App / 確認画面）で共有する純関数。
// 方針（2026-10-13 ユーザー決定）: 着用カットの写真を役割ごとの枠に入れ（ファイル名では判定しない）、写真の比率のまま、1 SKU 1 本。
export type CutRole = 'front' | 'right' | 'left' | 'back' | 'detail' | 'full'

export interface CutRoleDef { id: CutRole; label: string; hint: string }
export const CUT_ROLES: CutRoleDef[] = [
  { id: 'front', label: '正面', hint: '全身または上半身の正面。エレメントの主カットにもなる（必須）' },
  { id: 'right', label: '右側面', hint: '右向きの横姿' },
  { id: 'left', label: '左側面', hint: '左向きの横姿' },
  { id: 'back', label: '背面', hint: '後ろ姿' },
  { id: 'detail', label: 'ディテール', hint: '襟・前立て・ポケットなどの寄り' },
  { id: 'full', label: '全身', hint: '正面と別に全身を分ける場合' },
]
export const CUT_ROLE_LABEL: Record<CutRole, string> = Object.fromEntries(CUT_ROLES.map((r) => [r.id, r.label])) as Record<CutRole, string>
export const FRONTAL_ROLE: CutRole = 'front'
/** エレメントの別角度に使う優先順（最大 3 枚） */
export const REFERENCE_PRIORITY: CutRole[] = ['right', 'left', 'back', 'full', 'detail']

/** 1 ショット。endRole を指定すると「開始カット → 終了カット」の間を AI が埋める（回転など到達点を保証したい動き向け。2026-10-17） */
export interface VideoShotSpec { role: CutRole; duration: number; motion: string; endRole?: CutRole | null }

export interface VideoTemplateDef { id: string; label: string; description: string; shots: VideoShotSpec[] }
export const VIDEO_TEMPLATES: VideoTemplateDef[] = [
  {
    id: 'ec15', label: 'EC 標準 15 秒', description: '全身横 → 正面 → 背面 → ディテール → 正面（3 秒 × 5）',
    shots: [
      { role: 'right', duration: 3, motion: 'The model stands in profile, then slowly turns to face the camera with a relaxed stance, arms hanging naturally.' },
      { role: 'front', duration: 3, motion: 'The model stands facing the camera, breathes naturally and shifts weight slightly; the fabric drapes and catches the light.' },
      { role: 'back', duration: 3, motion: 'Seen from behind, the model slowly turns the head to glance over the shoulder; hair moves slightly.' },
      { role: 'detail', duration: 3, motion: 'Close-up of the garment. Very subtle motion only: slow breathing and a slight shift of weight; every detail stays exactly as it is.' },
      { role: 'front', duration: 3, motion: 'The model slowly turns about 45 degrees to show the side silhouette, then turns back; arms stay relaxed.' },
    ],
  },
  {
    id: 'turntable12', label: 'ターンテーブル 12 秒', description: '正面 → 右側面 → 背面 → 左側面 → 正面（各 3 秒・始点と終点を写真で指定）',
    shots: [
      { role: 'front', endRole: 'right', duration: 3, motion: 'The model turns smoothly in place to show the right side, ending exactly in the pose of the final frame; feet stay planted, arms relaxed.' },
      { role: 'right', endRole: 'back', duration: 3, motion: 'The model keeps turning smoothly in the same direction until the back is to the camera, ending exactly in the pose of the final frame.' },
      { role: 'back', endRole: 'left', duration: 3, motion: 'The model keeps turning smoothly in the same direction to show the left side, ending exactly in the pose of the final frame.' },
      { role: 'left', endRole: 'front', duration: 3, motion: 'The model completes the turn smoothly to face the camera again, ending exactly in the pose of the final frame.' },
    ],
  },
  {
    id: 'short9', label: 'ショート 9 秒', description: '全身横 → 正面 → ディテール（3 秒 × 3）',
    shots: [
      { role: 'right', duration: 3, motion: 'The model stands in profile, then slowly turns to face the camera with a relaxed stance, arms hanging naturally.' },
      { role: 'front', duration: 3, motion: 'The model stands facing the camera, breathes naturally and shifts weight slightly; the fabric drapes and catches the light.' },
      { role: 'detail', duration: 3, motion: 'Close-up of the garment. Very subtle motion only: slow breathing and a slight shift of weight; every detail stays exactly as it is.' },
    ],
  },
]

export const DEFAULT_BASE_PROMPT = 'Plain seamless studio background, soft even daylight, static camera on a tripod, no camera movement, no zoom. Keep the garment exactly as in the photos: same silhouette, fit, drape, color and details.'
export const DEFAULT_NEGATIVE_PROMPT = 'fast motion, hands close to the face, fingers manipulating buttons or collar, extra people, text, watermark, logo, camera shake, zoom, morphing fabric, changing garment details'

export const KLING_V3_I2V_ENDPOINT = 'fal-ai/kling-video/v3/pro/image-to-video'
export const MERGE_VIDEOS_ENDPOINT = 'fal-ai/ffmpeg-api/merge-videos'
export const VIDEO_MODEL_LABEL = 'Kling v3 Pro'
export const SHOT_DURATION_MIN = 3, SHOT_DURATION_MAX = 15   // Kling v3 の 1 本あたり
export const MAX_SHOTS = 8

export interface ProductVideoParams {
  templateId: string            // VIDEO_TEMPLATES の id、または 'custom'
  shots: VideoShotSpec[]        // テンプレートから展開した現在のショット列（custom なら自由編集）
  basePrompt: string            // 各ショットの先頭に付く共通の説明
  negativePrompt: string
}

const clampDur = (n: unknown) => Math.min(SHOT_DURATION_MAX, Math.max(SHOT_DURATION_MIN, Math.round(Number(n) || SHOT_DURATION_MIN)))
const isRole = (r: unknown): r is CutRole => typeof r === 'string' && CUT_ROLES.some((x) => x.id === r)

export function normalizeShots(raw: unknown): VideoShotSpec[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => {
      const role = isRole(s.role) ? s.role : FRONTAL_ROLE
      const endRole = isRole(s.endRole) && s.endRole !== role ? s.endRole : null
      return { role, duration: clampDur(s.duration), motion: typeof s.motion === 'string' ? s.motion : '', ...(endRole ? { endRole } : {}) }
    })
    .slice(0, MAX_SHOTS)
}

export function templateById(id: unknown): VideoTemplateDef | null {
  return VIDEO_TEMPLATES.find((t) => t.id === id) ?? null
}

export function normalizeProductVideoParams(raw: unknown): ProductVideoParams {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tpl = templateById(p.templateId) ?? VIDEO_TEMPLATES[0]
  const custom = p.templateId === 'custom'
  const shots = normalizeShots(p.shots)
  return {
    templateId: custom ? 'custom' : tpl.id,
    shots: shots.length ? shots : tpl.shots.map((s) => ({ ...s })),
    basePrompt: typeof p.basePrompt === 'string' ? p.basePrompt : DEFAULT_BASE_PROMPT,
    negativePrompt: typeof p.negativePrompt === 'string' ? p.negativePrompt : DEFAULT_NEGATIVE_PROMPT,
  }
}

/** 写し（またはキャンバス）から Product Video ノードを 1 つ取り出す（最初のもの） */
export function videoNodeOf(canvas: { nodes?: Array<{ id: string; data?: Record<string, unknown> | null } | null> | null } | null | undefined): { id: string; params: ProductVideoParams; label: string } | null {
  const nodes = canvas?.nodes
  if (!Array.isArray(nodes)) return null
  const n = nodes.find((x) => x?.data?.type === 'productVideo')
  if (!n) return null
  const label = typeof n.data?.label === 'string' && n.data.label.trim() ? n.data.label.trim() : 'Product Video'
  return { id: n.id, params: normalizeProductVideoParams(n.data?.params), label }
}

/** 1 SKU のカット（役割ごと 1 枚） */
export interface ItemCut { role: CutRole; path: string; width?: number | null; height?: number | null; name?: string }

/** 役割のカットを引く */
export function cutOf(cuts: ItemCut[] | null | undefined, role: CutRole): ItemCut | null {
  return (cuts ?? []).find((c) => c.role === role && !!c.path) ?? null
}

/** エレメント（人物 + 服）の正面と別角度（優先順で最大 3 枚） */
export function elementCutsOf(cuts: ItemCut[] | null | undefined): { frontal: ItemCut | null; references: ItemCut[] } {
  const frontal = cutOf(cuts, FRONTAL_ROLE)
  const references = REFERENCE_PRIORITY.map((r) => cutOf(cuts, r)).filter((c): c is ItemCut => !!c && c.path !== frontal?.path).slice(0, 3)
  return { frontal, references }
}

/** このショットを 1 SKU で作れるか: 開始の役割（と、終了カットがあるならその役割）のカットが揃っているか */
export function shotAvailable(shot: VideoShotSpec, cuts: ItemCut[] | null | undefined): boolean {
  return !!cutOf(cuts, shot.role) && (!shot.endRole || !!cutOf(cuts, shot.endRole))
}
/** 作れるショットの index。無いショットは飛ばして残りで組む（2026-10-13 決定） */
export function shotsAvailableFor(shots: VideoShotSpec[], cuts: ItemCut[] | null | undefined): number[] {
  return shots.map((s, i) => (shotAvailable(s, cuts) ? i : -1)).filter((i) => i >= 0)
}
/** ショットの見出し（例: 右側面 / 正面 → 右側面） */
export function shotRoleLabel(shot: VideoShotSpec): string {
  return shot.endRole ? `${CUT_ROLE_LABEL[shot.role]} → ${CUT_ROLE_LABEL[shot.endRole]}` : CUT_ROLE_LABEL[shot.role]
}

/** ショットのプロンプト = 共通の説明 + エレメント参照 + 動き */
export function shotPrompt(params: ProductVideoParams, shot: VideoShotSpec): string {
  const base = params.basePrompt.trim()
  return `${base ? base + '\n' : ''}@Element1 wearing the garment. ${shot.motion.trim()}`.trim()
}

/** タスクの node_id: ショットは <videoNodeId>:shot:<index>、結合はノード id そのもの */
export function shotTaskNodeId(videoNodeId: string, index: number): string { return `${videoNodeId}:shot:${index}` }
export function parseShotTaskNodeId(nodeId: string): { videoNodeId: string; index: number } | null {
  const m = /^(.+):shot:(\d+)$/.exec(nodeId)
  return m ? { videoNodeId: m[1], index: Number(m[2]) } : null
}

/** 合計秒数（飛ばすショットを除いた見込み） */
export function totalSeconds(shots: VideoShotSpec[], indices?: number[]): number {
  const idx = indices ?? shots.map((_, i) => i)
  return idx.reduce((s, i) => s + (shots[i]?.duration ?? 0), 0)
}
