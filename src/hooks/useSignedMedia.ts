import { useCallback, useState } from 'react'
import { signMediaRequest, toCanonicalRef } from '../lib/api/storage'

/**
 * 表示用メディアURLの onError 再署名フック（L2: サーバー署名）。
 * 失効・seam取りこぼし・>TTLで読み込みに失敗したら canonical へ戻して1回だけ再署名し差し替える。
 * canvas メディアは workflowId を渡して「ワークフローアクセス認可」で再署名、
 * カード(History/サムネ)は workflowId 無し＝Mode urls（生成出力の所有/共有判定）で再署名する。
 * 再署名でも直らなければ failed=true。ダウンロード直前用に freshUrl() も提供。
 */
export function useSignedMedia(
  initial: string | null | undefined,
  workflowId?: string | null,
): {
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

  const resign = useCallback(async (): Promise<string | undefined> => {
    const canonical = toCanonicalRef(url ?? initial)
    if (!canonical) return undefined
    const map = await signMediaRequest(workflowId ? { workflowId } : { urls: [canonical] })
    return map[canonical]
  }, [url, initial, workflowId])

  const onError = useCallback(() => {
    if (retried) {
      setFailed(true)
      return
    }
    setRetried(true)
    void resign().then((fresh) => {
      if (fresh && fresh !== (url ?? initial)) setUrl(fresh)
      else setFailed(true)
    })
  }, [retried, resign, url, initial])

  const freshUrl = useCallback(async (): Promise<string | null | undefined> => {
    const fresh = await resign()
    return fresh ?? url ?? initial
  }, [resign, url, initial])

  return { url, onError, failed, freshUrl }
}
