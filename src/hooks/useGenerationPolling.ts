// @deprecated - fal.ai は同期方式のためポーリング不要。このフックは今後使用しません。
// 他コンポーネントから参照されている可能性があるため削除はしていません。
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDefaultProvider } from '../lib/ai/provider-registry'
import type { GenerationResult } from '../lib/ai/types'

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 40 // ~2 minutes

interface UseGenerationPollingReturn {
  status: GenerationResult['status'] | null
  result: GenerationResult | null
  error: string | null
  isPolling: boolean
  stopPolling: () => void
}

export function useGenerationPolling(taskId: string | null): UseGenerationPollingReturn {
  const [status, setStatus] = useState<GenerationResult['status'] | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  const pollCountRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTaskIdRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setIsPolling(false)
  }, [])

  useEffect(() => {
    if (!taskId) return

    // Reset state when taskId changes
    pollCountRef.current = 0
    activeTaskIdRef.current = taskId
    setStatus('pending')
    setResult(null)
    setError(null)
    setIsPolling(true)

    const poll = async () => {
      // Guard: task changed or polling was stopped externally
      if (activeTaskIdRef.current !== taskId || timerRef.current === null) return

      pollCountRef.current += 1

      try {
        const provider = getDefaultProvider()
        const res = await provider.checkStatus(taskId)

        // Guard again after async call
        if (activeTaskIdRef.current !== taskId) return

        setStatus(res.status)
        setResult(res)

        if (res.status === 'completed' || res.status === 'failed') {
          if (res.status === 'failed') {
            setError(res.error ?? 'Generation failed')
          }
          setIsPolling(false)
          timerRef.current = null
          return
        }

        if (pollCountRef.current >= MAX_POLLS) {
          setError('Generation timed out after 2 minutes')
          setStatus('failed')
          setIsPolling(false)
          timerRef.current = null
          return
        }

        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      } catch (err) {
        if (activeTaskIdRef.current !== taskId) return
        setError((err as Error).message)
        setStatus('failed')
        setIsPolling(false)
        timerRef.current = null
      }
    }

    // Start first poll after one interval
    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)

    return () => {
      activeTaskIdRef.current = null
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [taskId])

  return { status, result, error, isPolling, stopPolling }
}
