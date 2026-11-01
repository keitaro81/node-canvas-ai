// App の「写真を追加」欄の写真（2026-11-02・一括処理と App の再設計 段階 2）: 一括処理の写真の一覧は App に置き、このブラウザに記憶する
// （ワークフローには書かない = チーム共有 App を複数人が使っても写真が混ざらない）。Batch Input ノードは試し用の ★ 1 枚だけを持つ。
// 以前のワークフローでノードに写真の一覧（2 枚以上）が入っていれば、App を初めて開いたときに一度だけ引き継ぐ。
import type { BatchItem } from '../../types/nodes'

const PREFIX = 'nc:batch-photos:'
const SEEDED = 'nc:batch-photos-seeded:'
const ready = (items: BatchItem[]) => items.filter((i) => i.status === 'ready' && !!i.path)

export function loadAppPhotos(key: string | null | undefined): BatchItem[] | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const data = JSON.parse(raw) as { items?: BatchItem[] }
    return Array.isArray(data.items) ? ready(data.items) : null
  } catch { return null }
}

export function saveAppPhotos(key: string | null | undefined, items: BatchItem[]): void {
  if (!key) return
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ v: 1, items: ready(items).map(({ id, index, originalName, sku, path, size, width, height }) => ({ id, index, originalName, sku, path, size, width, height, status: 'ready' })) })) } catch { /* 容量不足・プライベートモードなどは無視 */ }
}

export function clearAppPhotos(key: string | null | undefined): void {
  if (!key) return
  try { localStorage.removeItem(PREFIX + key) } catch { /* 無視 */ }
}

/** 最初の一覧: このブラウザの記憶 → 以前のノードの写真の一覧（2 枚以上・一度だけ）→ 空 */
export function initialAppPhotos(key: string | null | undefined, nodeItems: BatchItem[] | null | undefined): BatchItem[] {
  const saved = loadAppPhotos(key)
  if (saved) return saved
  const legacy = ready(nodeItems ?? [])
  if (!key || legacy.length < 2) return []
  try {
    if (localStorage.getItem(SEEDED + key)) return []
    localStorage.setItem(SEEDED + key, '1')
  } catch { return [] }
  return legacy
}
