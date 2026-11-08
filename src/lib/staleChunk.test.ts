import { describe, it, expect } from 'vitest'
import { isStaleChunkError, shouldReloadForStaleChunk, STALE_CHUNK_RELOAD_KEY } from './staleChunk'

describe('デプロイ直後の古いチャンクのエラー（2026-11-08 メモ 74）', () => {
  it('動的 import の失敗・MIME 違い・chunk 読み込み失敗を見分け、ほかのエラーは対象外', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/LibraryPage-CfKGMCJm.js'))).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError('Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"')).toBe(true)
    expect(isStaleChunkError(new Error('Loading chunk 12 failed'))).toBe(true)
    expect(isStaleChunkError({ message: 'Unable to preload CSS for /assets/x.css' })).toBe(true)
    expect(isStaleChunkError(new Error('Quota exceeded'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
    expect(isStaleChunkError(42)).toBe(false)
  })
  it('再読み込みは 30 秒に 1 回だけ（記録が無い・古いときだけ true、時刻を記録する）', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    expect(shouldReloadForStaleChunk(storage, 1_000_000)).toBe(true)
    expect(store.get(STALE_CHUNK_RELOAD_KEY)).toBe('1000000')
    expect(shouldReloadForStaleChunk(storage, 1_010_000)).toBe(false)   // 10 秒後 → まだ
    expect(shouldReloadForStaleChunk(storage, 1_040_000)).toBe(true)    // 40 秒後 → もう一度よい
    expect(shouldReloadForStaleChunk(null, 5)).toBe(true)              // 保存先が無ければ再読み込みはする
  })
})
