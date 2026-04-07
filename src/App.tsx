import { useEffect } from 'react'
import { RouterProvider } from 'react-router'
import './index.css'
import { router } from './router'
import { AuthGuard } from './components/auth/AuthGuard'
import { useAuthStore } from './stores/authStore'

function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    initialize().then((unsubscribe) => { cleanup = unsubscribe })
    return () => cleanup?.()
  }, [initialize])

  return (
    <AuthGuard>
      <RouterProvider router={router} />
    </AuthGuard>
  )
}

export default App
