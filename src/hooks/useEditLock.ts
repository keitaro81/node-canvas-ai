import { useEffect } from 'react'
import { useWorkflowStore, selectLockRequired } from '../stores/workflowStore'
import { useAuthStore } from '../stores/authStore'
import { acquireEditLock, fetchEditLock, releaseEditLock, releaseEditLockOnUnload, subscribeEditLock } from '../lib/api/workflowLocks'
import { getWorkflowStamp } from '../lib/api/workflows'
import { autoReleaseReason, holderLabel, lockViewFromAcquire, lockViewOf, LOCK_HEARTBEAT_MS, VIEWER_POLL_MS, type AcquireResult, type EditLockRow } from '../lib/workflow/editLock'
import { initialGate, nextGate, type ChannelStatus } from '../lib/batch/realtimeGate'
import { showToast } from './useToast'

const WATCHDOG_MS = 15_000
const LOCK_POLL_MS = 30_000

/**
 * 編集ロック（フェーズ B）の進行役。「チームの編集を許可」が ON のワークフローを開いている間だけ動く。
 * - 所有者は開いたら自動でロックを取って編集。メンバーはヘッダーの「編集する」で取る（editActions.start）
 * - 20 秒ごとに更新。他の人（自分の別タブ）が引き継いだら閲覧のみへ。無操作 10 分・タブ非表示 5 分で手放す
 * - ロック行を購読して「○○さんが編集中」を表示。閲覧中は版を見て他の人の保存を取り込む
 */
export function useEditLock(workflowId: string | undefined) {
  const lockRequired = useWorkflowStore(selectLockRequired)
  const canEdit = useWorkflowStore((s) => s.currentWorkflowCanEdit)
  const isOwned = useWorkflowStore((s) => s.currentWorkflowIsOwned)
  const currentId = useWorkflowStore((s) => s.currentWorkflowId)
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const active = !!workflowId && currentId === workflowId && lockRequired

  useEffect(() => {
    const store = useWorkflowStore
    if (!active || !workflowId) { store.getState().setEditActions(null); return }
    const sessionId = store.getState().editSessionId
    let disposed = false
    let heartbeat: ReturnType<typeof setInterval> | null = null
    let lockPoll: ReturnType<typeof setInterval> | null = null
    let lastActivity = Date.now()
    let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null
    const viewOf = (r: AcquireResult) => lockViewFromAcquire(r, userId, sessionId)

    // 閲覧側: 他の人の保存を取り込む（版が進んでいて、この画面に未保存の変更が無ければ読み直す）
    const refreshContentIfNewer = async () => {
      const st = store.getState()
      if (st.isSaving || st.isLoadingWorkflow || st.hasUnsavedChanges) return
      const stamp = await getWorkflowStamp(workflowId)
      if (disposed || !stamp) return
      if (stamp.canvasVersion > store.getState().currentWorkflowCanvasVersion) await store.getState().loadWorkflow(workflowId)
    }

    const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null } }
    const endEditing = async (reason: 'idle' | 'hidden' | 'taken' | 'manual', release: boolean) => {
      stopHeartbeat()
      const wasEditing = store.getState().editing
      store.getState().setEditing(false)
      if (wasEditing && reason !== 'manual') store.getState().setEditEnded(reason)
      if (release && wasEditing) await releaseEditLock(workflowId, sessionId).catch(() => false)
      if (!disposed) void refreshLock()
    }
    const startHeartbeat = () => {
      stopHeartbeat()
      heartbeat = setInterval(async () => {
        if (disposed || !store.getState().editing) return
        let r = await acquireEditLock(workflowId, sessionId, true)
        if (disposed) return
        // 自分のロックが消えていた（Jobs 画面の書き戻し後など）→ 取り直す
        if (!r.ok && r.reason === 'free') r = await acquireEditLock(workflowId, sessionId, false)
        if (disposed) return
        store.getState().setEditLock(viewOf(r))
        if (!r.ok) {
          showToast(r.same_user ? '別のタブで編集を始めたため、このタブは閲覧のみになりました' : `${holderLabel({ holderEmail: r.holder_email ?? null })} が編集を引き継いだため、閲覧のみになりました`, 'warning')
          await endEditing('taken', false)
        }
      }, LOCK_HEARTBEAT_MS)
    }
    const start = async (): Promise<boolean> => {
      if (!store.getState().currentWorkflowCanEdit) return false
      const r = await acquireEditLock(workflowId, sessionId, false)
      if (disposed) return false
      store.getState().setEditLock(viewOf(r))
      if (!r.ok) {
        if (r.reason === 'held') showToast(`${holderLabel({ holderEmail: r.holder_email ?? null })} が編集中です（90 秒更新が無ければ引き継げます）`, 'info')
        return false
      }
      lastActivity = Date.now()
      store.getState().setEditEnded(null)
      store.getState().setEditing(true)
      startHeartbeat()
      await refreshContentIfNewer()   // 編集を始める前に最新へ（未保存の変更が無いとき）
      return true
    }
    const stop = () => endEditing('manual', true)
    store.getState().setEditActions({ start, stop })

    // ロック行の反映（Realtime / ポーリング）
    const applyRow = (row: EditLockRow | null) => {
      if (disposed) return
      const v = lockViewOf(row, userId, sessionId)
      const wasEditing = store.getState().editing
      store.getState().setEditLock(v)
      if (wasEditing && (v.state === 'held' || v.state === 'mine-elsewhere')) {
        // 失効後の引き継ぎ・自分の別タブ → heartbeat を待たずに閲覧のみへ
        showToast(v.state === 'mine-elsewhere' ? '別のタブで編集を始めたため、このタブは閲覧のみになりました' : `${holderLabel(v)} が編集を引き継いだため、閲覧のみになりました`, 'warning')
        void endEditing('taken', false)
      } else if (!wasEditing && (v.state === 'free' || v.state === 'stale')) {
        void refreshContentIfNewer()   // 編集者が終えた＝保存が出ているかもしれない
      }
    }
    const refreshLock = async () => { const row = await fetchEditLock(workflowId); if (!disposed) applyRow(row) }
    let gate = initialGate()
    const startLockPolling = () => { if (!lockPoll) lockPoll = setInterval(() => { void refreshLock() }, LOCK_POLL_MS) }
    const unsub = subscribeEditLock(workflowId, applyRow, (status) => {
      gate = nextGate(gate, status as ChannelStatus)
      if (gate.gaveUp) { unsub(); startLockPolling() }
    })

    // 無操作・タブ非表示・タブを閉じる
    const onActivity = () => { lastActivity = Date.now() }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenSince = Date.now(); return }
      hiddenSince = null; lastActivity = Date.now()
      void refreshLock(); void refreshContentIfNewer()
    }
    const onPageHide = () => { if (store.getState().editing) releaseEditLockOnUnload(workflowId, sessionId) }
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity)
    window.addEventListener('wheel', onActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    const watchdog = setInterval(() => {
      if (disposed || !store.getState().editing) return
      const reason = autoReleaseReason(Date.now(), lastActivity, hiddenSince)
      if (!reason) return
      showToast(reason === 'idle' ? '10 分操作が無かったため編集を終了しました（他の人が編集できます）' : 'タブを 5 分以上離れていたため編集を終了しました', 'info')
      void endEditing(reason, true)
    }, WATCHDOG_MS)
    const viewerPoll = setInterval(() => {
      if (!store.getState().editing && document.visibilityState === 'visible') void refreshContentIfNewer()
    }, VIEWER_POLL_MS)

    // 初期化: ロック状態を読み、所有者は自動で編集を始める（従来どおりすぐ編集できる）。すでに編集中なら heartbeat だけ再開
    void (async () => {
      await refreshLock()
      if (disposed) return
      if (store.getState().editing) startHeartbeat()
      else if (isOwned && canEdit) await start()
    })()

    return () => {
      disposed = true
      stopHeartbeat(); clearInterval(watchdog); clearInterval(viewerPoll); if (lockPoll) clearInterval(lockPoll)
      unsub()
      window.removeEventListener('pointerdown', onActivity); window.removeEventListener('keydown', onActivity); window.removeEventListener('wheel', onActivity)
      document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onPageHide)
      store.getState().setEditActions(null)
      if (store.getState().editing) {
        // 画面を離れる／ロックが不要になった: ロックは返す。ロックが要るままなら閲覧へ（不要になったなら所有者はそのまま編集）
        if (selectLockRequired(store.getState())) store.getState().setEditing(false)
        void releaseEditLock(workflowId, sessionId).catch(() => false)
      }
    }
  }, [active, workflowId, userId, isOwned, canEdit])
}
