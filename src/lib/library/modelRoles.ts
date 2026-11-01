// ライブラリのモデル（人物）の役割（2026-11-01・設計 docs/specs/library-tryon.md §3）: モデルはあくまで着せ替え（試着）用なので役割は「向き」だけ。
// 正面（必須）/ 右側面 / 左側面 / 背面。ディテール・全身は商品動画の流用だったので枠から外す（既存データに入っていれば表示だけする）
import { CUT_ROLES, type CutRole, type CutRoleDef } from '../video/productVideo'

export const MODEL_ROLE_IDS: CutRole[] = ['front', 'right', 'left', 'back']
export const MODEL_ROLES: CutRoleDef[] = [
  { id: 'front', label: '正面', hint: '正面の立ち姿（必須）。EC の着用画像と商品動画の主カット' },
  { id: 'right', label: '右側面', hint: '右向きの横姿。側面の着用画像・回転の動画に' },
  { id: 'left', label: '左側面', hint: '左向きの横姿' },
  { id: 'back', label: '背面', hint: '後ろ姿（全身でよい）' },
]
export const isModelRole = (r: unknown): r is CutRole => typeof r === 'string' && (MODEL_ROLE_IDS as string[]).includes(r)
/** 枠に出す役割: 4 役割 + 既存データに入っている旧役割（ディテール・全身） */
export function modelRolesToShow(cuts: Partial<Record<CutRole, unknown>>): CutRoleDef[] {
  const extra = CUT_ROLES.filter((r) => !isModelRole(r.id) && !!cuts[r.id])
  return [...MODEL_ROLES, ...extra]
}
