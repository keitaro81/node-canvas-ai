import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSentry, Sentry } from './lib/sentry'
import { reloadIfStaleChunk } from './lib/staleChunk'

initSentry()

// デプロイ直後の古いタブ: Vite の動的 import（遅延読み込みの画面・CSS）が古いファイル名で失敗したら、一度だけ再読み込みして新しい版に乗り換える（2026-11-08 メモ 74）
window.addEventListener('vite:preloadError', (event) => {
  const payload = (event as Event & { payload?: unknown }).payload
  if (reloadIfStaleChunk(payload ?? new Error('Failed to fetch dynamically imported module'))) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: 24, color: '#A1A1AA', fontFamily: 'Inter, system-ui, sans-serif' }}>
          予期しないエラーが発生しました。ページを再読み込みしてください。
        </div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
