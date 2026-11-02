// 一括 App の「設定」をブラウザに覚える（ワークフロー × 入口ごと・2026-11-02 メモ 46）。読めない環境では覚えずに動く
import { useCallback, useState } from 'react'
import { parseAppSettings, type AppSettings } from '../lib/apps/appSettings'

function read(key: string): AppSettings {
  try { const raw = localStorage.getItem(key); return raw ? parseAppSettings(JSON.parse(raw)) : {} } catch { return {} }
}

export function useAppSettings(key: string): [AppSettings, (next: AppSettings) => void] {
  const [state, setState] = useState(() => ({ key, value: read(key) }))
  // キーが変わったら（別の App・入口）読み直す（レンダー中に同期する調整パターン）
  const current = state.key === key ? state.value : read(key)
  if (state.key !== key) setState({ key, value: current })
  const set = useCallback((next: AppSettings) => {
    setState({ key, value: next })
    try { if (Object.keys(next).length) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key) } catch { /* 覚えられなくても、この画面の間は使える */ }
  }, [key])
  return [current, set]
}
