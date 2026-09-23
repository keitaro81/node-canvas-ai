// レイアウトの識別値（仕様 4-3「パラメータとマスクから決まる値」/ 4-10「同じ内容の出力は作り直さない」）。
// ブラウザ・サーバー（Node 20+）どちらでも同じ値になるよう Web Crypto の SHA-256 を使う。
import type { LayoutParams } from '../../types/nodes'
import { normalizeLayoutParams } from './computeLayout'

export interface LayoutIdentityInput {
  params: LayoutParams
  sourceRef: string            // 元画像の canonical 参照
  maskPath: string             // 生マスクのパス
  alphaThreshold: number       // 切り抜き側のパラメータ（マスクの解釈に影響する）
  featherPx: number
  backgroundRef?: string | null
}

/** 識別値の元になる正規化文字列（キー順固定）。 */
export function layoutIdentityString(input: LayoutIdentityInput): string {
  const p = normalizeLayoutParams(input.params)
  const ordered = {
    v: 1,
    sourceRef: input.sourceRef,
    maskPath: input.maskPath,
    alphaThreshold: input.alphaThreshold,
    featherPx: input.featherPx,
    backgroundRef: input.backgroundRef ?? null,
    params: Object.fromEntries((Object.keys(p) as Array<keyof LayoutParams>).sort().map((k) => [k, p[k]])),
  }
  return JSON.stringify(ordered)
}

export async function layoutHash(input: LayoutIdentityInput): Promise<string> {
  const bytes = new TextEncoder().encode(layoutIdentityString(input))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
