import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router'
import { CircleNotch } from '@phosphor-icons/react'
import { Canvas } from './Canvas'
import { FloatingToolbar } from '../layout/FloatingToolbar'
import { StatusBar } from '../layout/StatusBar'
import { Header } from '../layout/Header'
import { CapsuleView } from '../capsule/CapsuleView'
import { BatchAppView } from '../app/BatchAppView'
import { appKindOf } from '../../lib/apps/appKind'
import { BatchSubmitDialog } from '../jobs/BatchSubmitDialog'
import { useWorkflowStore, selectCanEditNow } from '../../stores/workflowStore'
import { useCanvasStore } from '../../stores/canvasStore'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useEditLock } from '../../hooks/useEditLock'
import { SaveBlockedDialog } from './SaveBlockedDialog'
import { useTheme } from '../../hooks/useTheme'
import { useIsMobile } from '../../hooks/useIsMobile'
import { getWorkflowStamp } from '../../lib/api/workflows'
import { showToast } from '../../hooks/useToast'

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

export function CanvasPage({ initialMode }: { initialMode?: 'app' } = {}) {
  const { workflowId } = useParams<{ workflowId: string }>()
  const navigate = useNavigate()
  const { theme, toggle: toggleTheme } = useTheme()
  const { loadWorkflows, loadWorkflow } = useWorkflowStore()
  const canEditNow = useWorkflowStore(selectCanEditNow)
  const appMode = useCanvasStore((s) => s.appMode)
  const setAppMode = useCanvasStore((s) => s.setAppMode)
  const nodes = useCanvasStore((s) => s.nodes)
  // App の種類: Batch Input があれば撮影後工程の App（写真の投入 → 結果）、無ければ従来のグループ App
  const appKind = useMemo(() => appKindOf({ nodes: nodes.map((n) => ({ type: n.type, data: n.data as unknown as Record<string, unknown> })) }), [nodes])
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)

  useAutoSave()
  useEditLock(workflowId)

  // 他の画面（Jobs のレイアウト設定など）や他の人が保存したら、タブに戻ったときに読み直す（版で判定）。未保存の変更があれば知らせるだけ
  useEffect(() => {
    if (!workflowId) return
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      const { hasUnsavedChanges, isSaving, isLoadingWorkflow, currentWorkflowId, currentWorkflowCanvasVersion } = useWorkflowStore.getState()
      if (isSaving || isLoadingWorkflow || currentWorkflowId !== workflowId) return
      const stamp = await getWorkflowStamp(workflowId)
      if (!stamp || stamp.canvasVersion <= currentWorkflowCanvasVersion) return
      if (hasUnsavedChanges) { showToast('このワークフローは他の画面で更新されています。ここで保存すると衝突の確認が出ます', 'warning'); return }
      // レイアウトノード（バリアント）が変わったときだけ知らせる（生成結果の書込などでも版は進むため）
      const sig = () => JSON.stringify(useCanvasStore.getState().nodes.filter((n) => (n.data as { type?: string }).type === 'productLayout').map((n) => [n.id, (n.data as { params?: unknown }).params]))
      const before = sig()
      const mode = useCanvasStore.getState().appMode   // 読み直しでキャンバスが graph に戻るので、App モードならそのまま保つ
      await loadWorkflow(workflowId)
      if (mode !== useCanvasStore.getState().appMode) useCanvasStore.getState().setAppMode(mode)
      if (sig() !== before) showToast('他の画面でのバリアントの変更を読み込みました', 'info')
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [workflowId, loadWorkflow])

  // /app/:id から開いたときは App モードで始める
  useEffect(() => {
    if (initialMode === 'app') setAppMode('capsule')
  }, [initialMode, workflowId, setAppMode])

  // App モードの間、背面に隠れたキャンバスのノード選択を解除する（矢印キーや Delete が隠れたノードに効かないように）
  useEffect(() => {
    if (appMode === 'graph') return
    const { nodes: ns } = useCanvasStore.getState()
    if (ns.some((n) => n.selected)) useCanvasStore.setState({ nodes: ns.map((n) => (n.selected ? { ...n, selected: false } : n)) })
  }, [appMode])

  // モバイルでは常に capsule モードに固定
  useEffect(() => {
    if (isMobile && appMode !== 'capsule') {
      setAppMode('capsule')
    }
  }, [isMobile, appMode, setAppMode])

  useEffect(() => {
    if (!workflowId) {
      navigate('/projects')
      return
    }
    async function init() {
      try {
        await loadWorkflows()
        await loadWorkflow(workflowId!)
        // /app/:id: 読み込み（キャンバスの初期化で graph に戻る）の後に App モードへ
        if (initialMode === 'app') useCanvasStore.getState().setAppMode('capsule')
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
        {/* キャンバスは常に DOM に残す（ノードのイベントリスナーを維持するため）
            App モード・モバイル: absolute で背面に隠す（display:none だと React Flow が寸法計算できず <circle cx="NaN"> エラーになる。
            /app/:id のように最初から App モードで開くと初期化がその状態で走るので、デスクトップでも同じ隠し方にする） */}
        <div
          className="flex flex-1 min-h-0"
          style={
            isMobile || appMode !== 'graph'
              ? { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }
              : { display: 'flex' }
          }
        >
          <main className="flex-1 min-w-0 h-full relative">
            <Canvas />
            {canEditNow && <FloatingToolbar />}
            {/* TODO: RightPanel（ノード選択時の詳細パネル）は一旦非表示。必要に応じて復活させる */}
            {/* {canEditNow && <RightPanel />} */}
          </main>
        </div>
        {(appMode === 'capsule' || isMobile) && (appKind === 'batch' ? <BatchAppView /> : <CapsuleView />)}
      </div>

      {!isMobile && <StatusBar />}
      {/* 一括実行の確認 → 投入（Batch Input ノードの「一括実行…」から開く） */}
      <BatchSubmitDialog />
      {/* 保存できなかったとき（衝突・ロック切れ・権限）の選択 */}
      <SaveBlockedDialog />
    </div>
  )
}
