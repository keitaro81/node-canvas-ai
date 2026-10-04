// 履歴に並べるときの 1 行ラベル。使う人には「ジョブ」ではなく「いつ・何枚・どうなったか」で見せる。
// 名前はサーバーが「YYYY-MM-DD HH:mm n枚」で自動付与するので、それと同じ形なら重複して出さない（キャンバスから任意の名前を付けたときだけ添える）
import { formatJst } from './dates'
import { JOB_STATUS_META, type BatchJobRow } from '../../types/batch'

const AUTO_NAME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \d+\s*枚$/

/** サーバーの自動命名（日時 + 枚数）か */
export function isAutoJobName(name: string | null | undefined): boolean {
  return !name || AUTO_NAME.test(name.trim())
}

/** 例: '2026-10-04 19:27・2 枚・完了' / 名前付きなら '2026-10-04 19:27・2 枚・完了・秋物 第 1 便' */
export function jobLabel(job: Pick<BatchJobRow, 'name' | 'created_at' | 'item_count' | 'status'>): string {
  const status = JOB_STATUS_META[job.status]?.label ?? job.status
  const base = `${formatJst(job.created_at)}・${job.item_count} 枚・${status}`
  return isAutoJobName(job.name) ? base : `${base}・${job.name.trim()}`
}
