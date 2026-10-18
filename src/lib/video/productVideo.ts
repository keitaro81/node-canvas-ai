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
// ── 組み込みの文は日本語で表示・編集し、生成時に対訳の英語を使う（2026-10-17 ユーザー要望）。利用者が書いた日本語はジョブ作成時に LLM で英訳、英語はそのまま ──
const M = {
  sideToFront: '横向きに立ち、ゆっくり正面を向く。リラックスした立ち姿で、腕は自然に下ろす。',
  frontBreath: '正面を向いて立ち、自然に呼吸して重心をわずかに移す。布地のドレープに光が当たる。',
  backGlance: '後ろ姿のまま、ゆっくり振り向いて肩越しに視線を向ける。髪がわずかに揺れる。',
  detailStill: '服のクローズアップ。ごく小さな動きだけ（ゆっくりした呼吸とわずかな重心移動）。ディテールはそのまま。',
  front45: 'ゆっくり 45 度ほど回ってサイドのシルエットを見せ、また正面に戻る。腕はリラックス。',
  turnExtra: '足は動かさず、腕はリラックス。',
}
export const DEFAULT_BASE_PROMPT = '無地の白いスタジオ背景、やわらかく均一な自然光、三脚に固定したカメラ（カメラは動かさない・ズームしない）。服は写真のとおりに保つ（シルエット・フィット・ドレープ・色・ディテール）。'
export const DEFAULT_NEGATIVE_PROMPT = '速い動き、顔の近くの手、ボタンや襟をいじる指、他の人物、文字、透かし、ロゴ、手ブレ、ズーム、布地の変形、服のディテールの変化'
/** 組み込み文（日本語）→ 英語の対訳。生成時はこれを使うので LLM には送らない */
export const BUILTIN_EN: Record<string, string> = {
  [M.sideToFront]: 'The model stands in profile, then slowly turns to face the camera with a relaxed stance, arms hanging naturally.',
  [M.frontBreath]: 'The model stands facing the camera, breathes naturally and shifts weight slightly; the fabric drapes and catches the light.',
  [M.backGlance]: 'Seen from behind, the model slowly turns the head to glance over the shoulder; hair moves slightly.',
  [M.detailStill]: 'Close-up of the garment. Very subtle motion only: slow breathing and a slight shift of weight; every detail stays exactly as it is.',
  [M.front45]: 'The model slowly turns about 45 degrees to show the side silhouette, then turns back; arms stay relaxed.',
  [M.turnExtra]: 'Feet stay planted, arms relaxed.',
  [DEFAULT_BASE_PROMPT]: 'Plain seamless studio background, soft even daylight, static camera on a tripod, no camera movement, no zoom. Keep the garment exactly as in the photos: same silhouette, fit, drape, color and details.',
  [DEFAULT_NEGATIVE_PROMPT]: 'fast motion, hands close to the face, fingers manipulating buttons or collar, extra people, text, watermark, logo, camera shake, zoom, morphing fabric, changing garment details',
}
export const VIDEO_TEMPLATES: VideoTemplateDef[] = [
  {
    id: 'ec15', label: 'EC 標準 15 秒', description: '全身横 → 正面 → 背面 → ディテール → 正面（3 秒 × 5）',
    shots: [
      { role: 'right', duration: 3, motion: M.sideToFront },
      { role: 'front', duration: 3, motion: M.frontBreath },
      { role: 'back', duration: 3, motion: M.backGlance },
      { role: 'detail', duration: 3, motion: M.detailStill },
      { role: 'front', duration: 3, motion: M.front45 },
    ],
  },
  {
    id: 'turntable12', label: 'ターンテーブル 12 秒', description: '正面 → 右側面 → 背面 → 左側面 → 正面（各 3 秒・始点と終点を写真で指定）',
    shots: [
      // 回転の指示は turnInstruction() が (始点, 終点) から自動で付ける。motion は補足だけ
      { role: 'front', endRole: 'right', duration: 3, motion: M.turnExtra },
      { role: 'right', endRole: 'back', duration: 3, motion: M.turnExtra },
      { role: 'back', endRole: 'left', duration: 3, motion: M.turnExtra },
      { role: 'left', endRole: 'front', duration: 3, motion: M.turnExtra },
    ],
  },
  {
    id: 'short9', label: 'ショート 9 秒', description: '全身横 → 正面 → ディテール（3 秒 × 3）',
    shots: [
      { role: 'right', duration: 3, motion: M.sideToFront },
      { role: 'front', duration: 3, motion: M.frontBreath },
      { role: 'detail', duration: 3, motion: M.detailStill },
    ],
  },
]

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
  // 名前付きテンプレートは常に現在の定義を使う（保存された shots は選択時点の写し。編集すると 'custom' になる）。改良が既存のワークフローにも届く
  const shots = custom ? normalizeShots(p.shots) : tpl.shots.map((s) => ({ ...s }))
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
// ── 終了カットあり（始点 → 終点）の回転指示 ──
// 本番で「右側面 → 背面」が正面を経由して 270° 回った（2026-10-17）。原因は 2 つ: 回る向きが指示されていない / カスタム構成では静止ショット用の定型文
// （"stands facing the camera…"）が残っていて「正面を向け」と読める。そこで (始点, 終点) から向きと「途中で見える姿」「見せてはいけない姿」を自動で書き、
// 定型文は無視する。fal 直叩きの比較（2026-10-17・6/6 で正面を経由せず）に基づく言い回し。negative と cfg_scale も合わせて使う
const VIEW_OF: Record<CutRole, 'front' | 'side' | 'back' | 'other'> = { front: 'front', full: 'front', right: 'side', left: 'side', back: 'back', detail: 'other' }
const NEG_NO_FRONT = 'facing the camera, front view, face toward the camera, turning toward the camera'
const NEG_NO_BACK = 'back view, back to the camera, turning away from the camera'
export const END_CUT_CFG_SCALE = 0.7   // 終了カットありは指示への追従を強める（既定 0.5）
export function turnInstruction(role: CutRole, endRole: CutRole): { motion: string; negative: string | null } {
  const a = VIEW_OF[role], b = VIEW_OF[endRole]
  if (a === 'front' && b === 'side') return { motion: 'Facing the camera, the model makes a short quarter turn and stops in profile exactly as in the final frame. Midway the camera sees a three-quarter front view; the back is never shown.', negative: NEG_NO_BACK }
  if (a === 'side' && b === 'back') return { motion: 'Seen in profile, the model keeps turning away from the camera, a short quarter turn, until the back faces the camera exactly as in the final frame. Midway through the turn the camera sees the back of the shoulder and the back of the head; the face is turned away and never visible. The front of the body is never shown.', negative: NEG_NO_FRONT }
  if (a === 'back' && b === 'side') return { motion: 'Seen from behind, the model pivots a short quarter turn in place and ends up in profile exactly as in the final frame. Midway the camera sees a three-quarter back view, the back of the shoulder and the back of the head; the face stays hidden and the model never turns to face the camera.', negative: NEG_NO_FRONT }
  if (a === 'side' && b === 'front') return { motion: 'Seen in profile, the model makes a short quarter turn toward the camera and stops facing it exactly as in the final frame. Midway the camera sees a three-quarter front view; the back is never shown.', negative: NEG_NO_BACK }
  if (a === 'front' && b === 'back') return { motion: 'Facing the camera, the model turns around in one smooth half turn until the back faces the camera exactly as in the final frame.', negative: null }
  if (a === 'back' && b === 'front') return { motion: 'Seen from behind, the model turns around in one smooth half turn to face the camera exactly as in the final frame.', negative: null }
  if (a === 'side' && b === 'side') return { motion: 'Seen in profile, the model turns in one smooth half turn through the front view and stops in the opposite profile exactly as in the final frame.', negative: NEG_NO_BACK }
  return { motion: 'The model moves smoothly from the first pose into the pose of the final frame by the shortest movement.', negative: null }
}
/** 静止ショット用の定型文（テンプレートの motion と同じ文）。終了カットありのショットに残っていても指示には使わない */
const STATIC_PRESETS = new Set(VIDEO_TEMPLATES.flatMap((t) => t.shots.filter((s) => !s.endRole).flatMap((s) => [s.motion.trim(), BUILTIN_EN[s.motion.trim()] ?? ''])).filter(Boolean))
export const isStaticPresetMotion = (motion: string) => STATIC_PRESETS.has(motion.trim())

// ── 翻訳（日本語で編集 → 生成時に英語） ──
export const hasJapanese = (s: string) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/.test(s)
/** 組み込み文（日本語）の対訳。該当しなければ null */
export const builtinEnglish = (s: string): string | null => BUILTIN_EN[s.trim()] ?? null
/** 生成前に英訳が要る文 = 利用者が書いた日本語（組み込み文は対訳あり、英語はそのまま、終了カットありの静止用定型文は使われないので除く） */
export function promptTextsToTranslate(params: ProductVideoParams): string[] {
  const out = new Set<string>()
  const consider = (text: string) => { const t = text.trim(); if (t && hasJapanese(t) && !builtinEnglish(t)) out.add(t) }
  consider(params.basePrompt); consider(params.negativePrompt)
  for (const sh of params.shots) if (!(sh.endRole && isStaticPresetMotion(sh.motion))) consider(sh.motion)
  return [...out]
}
/** プロンプト組み立て用に英語へ寄せたパラメータ。翻訳表に無い日本語はそのまま（表示用の params はこれを通さない） */
export function applyPromptTranslations(params: ProductVideoParams, map: Record<string, string> | null | undefined): ProductVideoParams {
  const tr = (text: string) => { const t = text.trim(); return map?.[t] ?? builtinEnglish(t) ?? text }
  return { ...params, basePrompt: tr(params.basePrompt), negativePrompt: tr(params.negativePrompt), shots: params.shots.map((sh) => ({ ...sh, motion: tr(sh.motion) })) }
}

export function shotPrompt(params: ProductVideoParams, shot: VideoShotSpec): string {
  const base = params.basePrompt.trim()
  if (shot.endRole) {
    const turn = turnInstruction(shot.role, shot.endRole)
    const extra = isStaticPresetMotion(shot.motion) ? '' : shot.motion.trim()
    const toEnd = 'One continuous take with no cuts: the pose changes directly into the final frame by the shortest movement.'
    return `${base ? base + '\n' : ''}@Element1 wearing the garment. ${[turn.motion, extra, toEnd].filter(Boolean).join(' ')}`.trim()
  }
  return `${base ? base + '\n' : ''}@Element1 wearing the garment. ${shot.motion.trim()}`.trim()
}
/** ショットの negative_prompt（終了カットありは見せてはいけない向きを足す） */
export function shotNegativePrompt(params: ProductVideoParams, shot: VideoShotSpec): string {
  const add = shot.endRole ? turnInstruction(shot.role, shot.endRole).negative : null
  return [params.negativePrompt.trim(), add].filter(Boolean).join(', ')
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
