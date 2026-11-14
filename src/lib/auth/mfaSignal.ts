// サーバーが「2 段階認証が必要」と断ったことを、判定のストアへ知らせる合図（2026-11-14）。
// API のラッパー（team / admin / batch / storage / generations）は応答をここへ渡すだけ。ストアを直接 import しない（循環を避ける）。
import { isMfaRequiredResponse } from './mfaGate'

let handler: (() => void) | null = null

/** 判定のストアが登録する（1 つだけ） */
export function onMfaRequired(fn: (() => void) | null): void {
  handler = fn
}

/** 応答が 403 ＋ code = 'mfa_required' なら、判定を取り直させる */
export function noteMfaResponse(status: number, body: unknown): void {
  if (isMfaRequiredResponse(status, body)) handler?.()
}

/** 所属チームが変わったとき（参加・離脱）に、判定を取り直させる（新しいチームが必須にしているかもしれない） */
export function recheckMfa(): void {
  handler?.()
}
