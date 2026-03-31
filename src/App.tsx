import { useState, useEffect } from 'react'
import './index.css'
import { initFalClient } from './lib/ai/fal-client'
import { Canvas } from './components/canvas/Canvas'
import { Header } from './components/layout/Header'
import { LeftSidebar } from './components/layout/LeftSidebar'
import { RightPanel } from './components/panels/RightPanel'
import { StatusBar } from './components/layout/StatusBar'
import { AuthGuard } from './components/auth/AuthGuard'
import { useAuthStore } from './stores/authStore'
import { useWorkflowStore } from './stores/workflowStore'
import { useAutoSave } from './hooks/useAutoSave'

function AppInner() {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)
  const { loadWorkflows, createNewWorkflow, loadWorkflow } = useWorkflowStore()

  useAutoSave()

  useEffect(() => {
    initFalClient();
  }, [])

  useEffect(() => {
    async function init() {
      try {
        console.log('[App] ワークフロー初期化開始')
        await loadWorkflows()
        const list = useWorkflowStore.getState().workflows
        console.log('[App] ワークフロー一覧:', list.length, '件')
        if (list.length > 0) {
          await loadWorkflow(list[0].id)
          console.log('[App] ワークフロー読み込み完了:', list[0].id)
        } else {
          await createNewWorkflow()
          console.log('[App] 新規ワークフロー作成完了')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[App] ワークフロー初期化エラー:', err)
        setInitError(msg)
      }
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col h-full w-full" style={{ background: '#0A0A0B' }}>
      <Header />

      {initError && (
        <div
          className="mx-4 mt-2 px-3 py-2 rounded-lg text-[12px] text-[#EF4444] flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <span className="font-medium">DB エラー:</span>
          <span>{initError}</span>
          <button
            className="ml-auto text-[#71717A] hover:text-[#FAFAFA] underline text-[11px]"
            onClick={() => setInitError(null)}
          >
            閉じる
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        <LeftSidebar open={leftOpen} onToggle={() => setLeftOpen((v) => !v)} />
        <main className="flex-1 min-w-0 h-full">
          <Canvas />
        </main>
        <RightPanel open={rightOpen} onToggle={() => setRightOpen((v) => !v)} />
      </div>

      <StatusBar />
    </div>
  )
}

function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    initialize().then((unsubscribe) => { cleanup = unsubscribe })
    return () => cleanup?.()
  }, [initialize])

  return (
    <AuthGuard>
      <AppInner />
    </AuthGuard>
  )
}

export default App
