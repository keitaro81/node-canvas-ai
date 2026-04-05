import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'node-canvas-theme'
const EVENT_NAME = 'theme-change'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return 'light'
}

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  localStorage.setItem(STORAGE_KEY, theme)
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // 初回マウント時にDOMに適用
  useEffect(() => {
    applyTheme(theme)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 他のuseThemeインスタンスからの変更を受け取る
  useEffect(() => {
    function handleChange(e: Event) {
      const next = (e as CustomEvent<{ theme: Theme }>).detail.theme
      setTheme(next)
    }
    window.addEventListener(EVENT_NAME, handleChange)
    return () => window.removeEventListener(EVENT_NAME, handleChange)
  }, [])

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
    // 全インスタンスに通知
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { theme: next } }))
  }

  return { theme, toggle }
}
