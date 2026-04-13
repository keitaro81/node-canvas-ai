import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import { CircleNotch } from '@phosphor-icons/react'
import { Canvas } from './Canvas'
import { FloatingToolbar } from '../layout/FloatingToolbar'
import { StatusBar } from '../layout/StatusBar'
import { Header } from '../layout/Header'
import { CapsuleView } from '../capsule/CapsuleView'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useCanvasStore } from '../../stores/canvasStore'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useTheme } from '../../hooks/useTheme'
import { ToastContainer } from '../ui/ToastContainer'

function LoadingScreen() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--bg-canvas)' }}
    >
      <div className="flex flex-col items-center gap-3">
        <CircleNotch size={28} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Loading workflow...</span>
      </div>
    </div>
  )
}

export function CanvasPage() {
  const { workflowId } = useParams<{ workflowId: string }>()
  const navigate = useNavigate()
  const { theme, toggle: toggleTheme } = useTheme()
  const { loadWorkflows, loadWorkflow } = useWorkflowStore()
  const isOwned = useWorkflowStore((s) => s.currentWorkflowIsOwned)
  const appMode = useCanvasStore((s) => s.appMode)
  const [loading, setLoading] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)

  useAutoSave()

  useEffect(() => {
    if (!workflowId) {
      navigate('/projects')
      return
    }
    async function init() {
      try {
        await loadWorkflows()
        await loadWorkflow(workflowId!)
      } catch (err) {
        console.error('[CanvasPage] 初期化エラー:', err)
        // ワークフローが見つからない場合（PGRST116）はプロジェクト一覧へ
        const code = (err as { code?: string })?.code
        if (code === 'PGRST116') {
          navigate('/projects')
          return
        }
        const msg = err instanceof Error ? err.message : String(err)
        setInitError(msg)
      } finally {
        setLoading(false)
      }
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId])

  if (loading) return <LoadingScreen />

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--bg-canvas)' }}>
      <Header theme={theme} onToggleTheme={toggleTheme} />

      {initError && (
        <div
          className="mx-4 mt-2 px-3 py-2 rounded-lg text-[12px] text-[#EF4444] flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <span className="font-medium">DB エラー:</span>
          <span>{initError}</span>
          <button
            className="ml-auto text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline text-[11px]"
            onClick={() => setInitError(null)}
          >
            閉じる
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        <div
          className="flex flex-1 min-h-0"
          style={{ display: appMode !== 'graph' ? 'none' : 'flex' }}
        >
          <main className="flex-1 min-w-0 h-full relative">
            <Canvas />
            {isOwned && <FloatingToolbar />}
            {/* TODO: RightPanel（ノード選択時の詳細パネル）は一旦非表示。必要に応じて復活させる */}
            {/* {isOwned && <RightPanel />} */}
          </main>
        </div>
        {appMode === 'capsule' && <CapsuleView />}
      </div>

      <StatusBar />
      <ToastContainer />
    </div>
  )
}
