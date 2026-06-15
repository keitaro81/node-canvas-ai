import { useCallback, useState } from 'react'
import { getSignedUrl, toCanonicalRef } from '../lib/api/storage'

/**
 * 表示用メディアURLの onError 再署名フック（バケット非公開化 L1 の安全網）。
 * 入力は通常すでに署名済みURL（読込口で署名済み）。失効・seam取りこぼし・>TTLで読み込みに失敗したら、
 * canonical へ戻して1回だけ再署名して差し替える。再署名でも直らなければ failed=true を返す。
 * ダウンロード直前用に freshUrl()（その場で再署名）も提供。
 */
export function useSignedMedia(initial: string | null | undefined): {
  url: string | null | undefined
  onError: () => void
  failed: boolean
  freshUrl: () => Promise<string | null | undefined>
} {
  const [url, setUrl] = useState<string | null | undefined>(initial)
  const [prevInitial, setPrevInitial] = useState(initial)
  const [retried, setRetried] = useState(false)
  const [failed, setFailed] = useState(false)

  // 入力が変わったらレンダー中に同期（effect での setState を避ける調整パターン）
  if (initial !== prevInitial) {
    setPrevInitial(initial)
    setUrl(initial)
    setRetried(false)
    setFailed(false)
  }

  const onError = useCallback(() => {
    if (retried) {
      setFailed(true)
      return
    }
    setRetried(true)
    const canonical = toCanonicalRef(url ?? initial)
    if (!canonical) {
      setFailed(true)
      return
    }
    void getSignedUrl(canonical).then((fresh) => {
      if (fresh && fresh !== (url ?? initial)) setUrl(fresh)
      else setFailed(true)
    })
  }, [retried, url, initial])

  const freshUrl = useCallback(async (): Promise<string | null | undefined> => {
    const canonical = toCanonicalRef(url ?? initial)
    const fresh = await getSignedUrl(canonical)
    return fresh ?? url ?? initial
  }, [url, initial])

  return { url, onError, failed, freshUrl }
}
