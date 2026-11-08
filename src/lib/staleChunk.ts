// デプロイ直後の「古い画面のまま開いていたタブ」対策（2026-11-08 メモ 74）。
// 画面遷移で古いファイル名のチャンク（assets/LibraryPage-xxxx.js など）を読みに行くと、新しいデプロイにはそのファイルが無く、
// SPA の書き換えで index.html（text/html）が返ってモジュールとして読めない → React Router の既定のエラー画面になっていた。
// そのときは一度だけ自動で再読み込みして新しい版に乗り換える（短い間隔で繰り返さない＝本当に壊れているときの無限ループを防ぐ）。

const PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Expected a JavaScript(-or-Wasm)? module script/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Unable to preload CSS/i,
]

/** 古いチャンクを読みに行って失敗したエラーか */
export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message
  if (typeof msg !== 'string') return false
  return PATTERNS.some((p) => p.test(msg))
}

export const STALE_CHUNK_RELOAD_KEY = 'nc:stale-chunk-reload-at'
export const STALE_CHUNK_RELOAD_MIN_INTERVAL_MS = 30_000

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** 直近 30 秒以内に再読み込みしていなければ true を返し、再読み込みした時刻を記録する（呼び出し側が reload する） */
export function shouldReloadForStaleChunk(storage: StorageLike | null | undefined, now = Date.now()): boolean {
  if (!storage) return true
  let last = 0
  try { last = Number(storage.getItem(STALE_CHUNK_RELOAD_KEY) ?? 0) } catch { last = 0 }
  if (Number.isFinite(last) && last > 0 && now - last < STALE_CHUNK_RELOAD_MIN_INTERVAL_MS) return false
  try { storage.setItem(STALE_CHUNK_RELOAD_KEY, String(now)) } catch { /* 保存できなくても再読み込みはする */ }
  return true
}

/** ブラウザで: 古いチャンクのエラーなら一度だけ再読み込みする。再読み込みしたら true */
export function reloadIfStaleChunk(err: unknown): boolean {
  if (!isStaleChunkError(err)) return false
  if (typeof window === 'undefined') return false
  let storage: StorageLike | null = null
  try { storage = window.sessionStorage } catch { storage = null }
  if (!shouldReloadForStaleChunk(storage)) return false
  window.location.reload()
  return true
}
