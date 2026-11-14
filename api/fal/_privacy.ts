// fal 側に生成物を置きっぱなしにしないための指定（2026-11-14・メモ 83）。
// `_` 始まりのファイルは Vercel のルーティング対象外（共有モジュール）。
//
// fal は既定で、生成物のファイルを配信用の場所に置き続ける。利用者の画像（未発表の商品など）を fal 側に残さないために、
// 生成の依頼に期限の指定を付ける:
//   X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": n}  … 生成物のファイルを n 秒後に消す（実機で確認: 60 秒の指定で 90 秒後に 403）
// 生成物はアプリが完了の直後に自前の保存先（Supabase）へ写すので、fal 側のファイルは「取りに行くまでの猶予」だけあればよい。
// 猶予は既定 7 日（生成中にタブを閉じて、後日開き直したときの復旧のため。一括処理の照合にも使う）。
//
// 依頼の入力と出力（JSON: プロンプト・画像の URL）は fal の履歴に残る（fal の既定）。これも残さない指定（X-Fal-Store-IO: 0）があるが、
// 付けると結果そのもの（queue の …/requests/<id>）も完了から約 1 時間で取り出せなくなり（実機: 46 分後は取得でき、90 分後は 404）、
// 「生成中にタブを閉じて 1 時間以上あとに開き直す」と復旧できなくなる。ユーザー決定（2026-11-14）= ファイルの期限だけ付ける。
// 入出力も残したくなったら、環境変数 FAL_STORE_IO=0 で付けられる（上の引き換えを承知のうえで）。
//
// fal へ依頼を出す入口は 3 つ: プロキシ（_proxyLogic.ts）・一括処理（api/batch/_batchLogic.ts）・LLM（_llm.ts）。入口を足したら必ず付ける。
import { cleanEnv } from '../../src/lib/env'

export const FAL_STORE_IO_HEADER = 'X-Fal-Store-IO'
export const FAL_OBJECT_LIFECYCLE_HEADER = 'X-Fal-Object-Lifecycle-Preference'

/** 生成物のファイルを fal 側に残す秒数の既定（7 日） */
export const DEFAULT_FAL_MEDIA_TTL_SECONDS = 7 * 24 * 60 * 60
/** これより短くはしない（1 時間）。短すぎると、長い動画の結果を自前の保存先へ写す前に消える */
export const MIN_FAL_MEDIA_TTL_SECONDS = 60 * 60

const SUBMIT_HOSTS = ['queue.fal.run', 'queue.fal.ai', 'fal.run', 'fal.ai']

/**
 * 生成物のファイルを fal 側に残す秒数。環境変数 FAL_MEDIA_TTL_SECONDS で変えられる（例: 86400 = 1 日）。
 * 'off' は期限を指定しない（fal の既定どおり残る）。読めない値は既定の 7 日（設定の書き間違いで「残し続ける」にしない）。
 */
export function falMediaTtlSeconds(raw: string | null | undefined = env('FAL_MEDIA_TTL_SECONDS')): number | null {
  const v = cleanEnv(raw).toLowerCase()
  if (!v) return DEFAULT_FAL_MEDIA_TTL_SECONDS
  if (v === 'off') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FAL_MEDIA_TTL_SECONDS
  return Math.max(MIN_FAL_MEDIA_TTL_SECONDS, Math.floor(n))
}

/** 入出力（JSON）も fal の履歴に残さないか。環境変数 FAL_STORE_IO が '0' のときだけ（既定は残す = 復旧を優先） */
export function falSkipsPayloadStorage(raw: string | null | undefined = env('FAL_STORE_IO')): boolean {
  return cleanEnv(raw) === '0'
}

/** 生成の依頼に付けるヘッダー（生成物のファイルは期限つき。設定されていれば入出力も保存しない） */
export function falPrivacyHeaders(ttlRaw: string | null | undefined = env('FAL_MEDIA_TTL_SECONDS'), storeIoRaw: string | null | undefined = env('FAL_STORE_IO')): Record<string, string> {
  const headers: Record<string, string> = {}
  const ttl = falMediaTtlSeconds(ttlRaw)
  if (ttl !== null) headers[FAL_OBJECT_LIFECYCLE_HEADER] = JSON.stringify({ expiration_duration_seconds: ttl })
  if (falSkipsPayloadStorage(storeIoRaw)) headers[FAL_STORE_IO_HEADER] = '0'
  return headers
}

/** 生成の依頼（投入）か: POST かつ実行ホスト（queue / 同期）で、状態の確認・結果の取得・取り消し（/requests/）ではない */
export function isFalSubmit(method: string, url: URL): boolean {
  return method.toUpperCase() === 'POST' && SUBMIT_HOSTS.includes(url.hostname) && !url.pathname.includes('/requests/')
}

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined
}
