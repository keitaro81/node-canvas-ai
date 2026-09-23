import { useEffect, Suspense } from 'react'
import { RouterProvider } from 'react-router'
import './index.css'
import { router } from './router'
import { AuthGuard } from './components/auth/AuthGuard'
import { useAuthStore } from './stores/authStore'
import { ToastContainer } from './components/ui/ToastContainer'
import { PageLoading } from './components/ui/PageLoading'
import { BatchSync } from './components/jobs/BatchSync'

function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    initialize().then((unsubscribe) => { cleanup = unsubscribe })
    return () => cleanup?.()
  }, [initialize])

  return (
    <AuthGuard>
      {/* 遅延ロードされる route（canvas / join / admin / legal 等）のフォールバック境界 */}
      <Suspense fallback={<div className="h-screen w-full flex items-center justify-center" style={{ background: 'var(--bg-canvas)' }}><PageLoading /></div>}>
        <RouterProvider router={router} />
      </Suspense>
      <ToastContainer />
      {/* 一括実行: 進行中ジョブの復元・再開・照合・Realtime 購読（ログイン後に 1 回起動） */}
      <BatchSync />
    </AuthGuard>
  )
}

export default App
