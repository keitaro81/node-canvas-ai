import { useState, useCallback, useEffect } from 'react'

export interface Toast {
  id: string
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
}

// グローバルな状態（Canvas 外からも呼べるようにモジュールレベルで管理）
type Listener = (toasts: Toast[]) => void
let toasts: Toast[] = []
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((l) => l([...toasts]))
}

export function showToast(message: string, type: Toast['type'] = 'info') {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts = [...toasts, { id, message, type }]
  notify()
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    notify()
  }, 4000)
}

export function useToast() {
  const [items, setItems] = useState<Toast[]>([...toasts])

  useEffect(() => {
    listeners.add(setItems)
    return () => { listeners.delete(setItems) }
  }, [])

  const dismiss = useCallback((id: string) => {
    toasts = toasts.filter((t) => t.id !== id)
    notify()
  }, [])

  return { items, dismiss }
}
