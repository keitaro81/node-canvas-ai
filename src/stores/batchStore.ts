// 一括実行（バッチ）のクライアント状態（仕様 4-8）:
// 進行中ジョブ・本日の利用枚数・上限・原価表示の可否・Realtime 購読・アプリを開いた時の再開と照合。
// 一覧ページは jobsVersion の変化で現在ページを再取得する（Realtime のイベントを行にマージしない）。
import { useEffect } from 'react'
import { create } from 'zustand'
import type { BatchJobRow } from '../types/batch'
import { disconnectRealtime, fetchActiveJobs, fetchTeamBatchLimits, fetchTeamBatchSettings, fetchUsedToday, subscribeTeamJobs } from '../lib/api/batchJobs'
import { initialGate, nextGate, shouldSubscribeJobs, type GateState } from '../lib/batch/realtimeGate'
import { batchReconcile, submitJobFully } from '../lib/api/batch'
import { getTeamInfo } from '../lib/api/team'
import { isResumableJob } from '../lib/batch/jobsQuery'

const RECONCILE_MIN_INTERVAL_MS = 60_000
const REFRESH_DEBOUNCE_MS = 300
const POLL_TICK_MS = 15_000            // 再取得の刻み: Realtime なし=15 秒ごと / Realtime あり=進行中ジョブがある間 30 秒ごと（保険）
const REALTIME_DEADLINE_MS = 25_000    // この時間内に購読できなければ諦めて再取得に切り替える
const REALTIME_RETRY_MS = 5 * 60_000   // 諦めた後、タブ復帰時に再挑戦する間隔

interface BatchState {
  teamId: string | null
  userId: string | null
  role: 'owner' | 'member' | null
  dailyLimit: number
  showCost: boolean
  usedToday: number
  activeCount: number            // チーム全体の進行中ジョブ数（見えないジョブも含む）
  activeJobs: BatchJobRow[]      // 自分に見える進行中ジョブ（バッジ・再開・一覧に使う）
  jobsVersion: number
  memberNames: Record<string, string>
  ready: boolean
  /** null=接続中 / true=購読中 / false=接続できず再取得ポーリングで代替中 */
  realtimeOk: boolean | null
  submitDialogNodeId: string | null

  start: (teamId: string, userId: string, role: 'owner' | 'member') => Promise<void>
  stop: () => void
  refresh: () => Promise<void>
  bump: () => void
  reconcileNow: (force?: boolean) => Promise<void>
  openSubmitDialog: (nodeId: string) => void
  closeSubmitDialog: () => void
  /** ジョブの変更を Realtime で追いたい画面（ジョブ管理・一括結果ノード）が登録する。登録が無く進行中ジョブも無ければ購読しない（DB の WAL ポーリングを止める） */
  watch: (key: string) => void
  unwatch: (key: string) => void
}

let unsubscribe: (() => void) | null = null
let gate: GateState = initialGate()
let deadlineTimer: ReturnType<typeof setTimeout> | null = null
let lastRealtimeAttempt = 0
let pollTick = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let lastReconcileAt = 0
let visibilityHandler: (() => void) | null = null
const resuming = new Set<string>()
const watchers = new Set<string>()
let realtimeTeamId: string | null = null

// ── Realtime 購読（自チームの batch_jobs）。接続できない環境では諦めて再取得ポーリングに切り替える ──
function stopRealtime(): void {
  unsubscribe?.(); unsubscribe = null
  if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null }
}
function giveUpRealtime(): void {
  stopRealtime()
  disconnectRealtime()
  if (useBatchStore.getState().realtimeOk !== false) {
    useBatchStore.setState({ realtimeOk: false })
    console.warn('[batch] Realtime に接続できないため、定期的な再取得（15〜20 秒ごと）に切り替えました。他のメンバーの変更は少し遅れて反映されます')
  }
}
function startRealtime(teamId: string): void {
  stopRealtime()
  gate = initialGate()
  lastRealtimeAttempt = Date.now()
  const { bump } = useBatchStore.getState()
  unsubscribe = subscribeTeamJobs(teamId, () => bump(), (status) => {
    gate = nextGate(gate, status)
    if (gate.subscribed) {
      if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null }
      if (useBatchStore.getState().realtimeOk !== true) useBatchStore.setState({ realtimeOk: true })
    } else if (gate.gaveUp) {
      giveUpRealtime()
    }
  })
  deadlineTimer = setTimeout(() => { if (!gate.subscribed) giveUpRealtime() }, REALTIME_DEADLINE_MS)
}
/** 購読の要否を見直す: 追いたい画面があるか、進行中ジョブがある間だけ購読する。要らなくなったら切る */
function syncRealtime(): void {
  const s = useBatchStore.getState()
  const want = !!realtimeTeamId && shouldSubscribeJobs(watchers.size, s.activeJobs.length)
  if (want) {
    if (unsubscribe) return
    // 諦めた直後は再挑戦を間隔を空けて（それまではポーリングで代替）
    if (s.realtimeOk === false && Date.now() - lastRealtimeAttempt < REALTIME_RETRY_MS) return
    startRealtime(realtimeTeamId!)
  } else if (unsubscribe || s.realtimeOk === false) {
    stopRealtime()
    disconnectRealtime()
    if (s.realtimeOk !== null) useBatchStore.setState({ realtimeOk: null })
  }
}

export const useBatchStore = create<BatchState>((set, get) => ({
  teamId: null,
  userId: null,
  role: null,
  dailyLimit: 300,
  showCost: false,
  usedToday: 0,
  activeCount: 0,
  activeJobs: [],
  jobsVersion: 0,
  memberNames: {},
  ready: false,
  realtimeOk: null,
  submitDialogNodeId: null,

  start: async (teamId, userId, role) => {
    if (get().teamId === teamId && get().userId === userId) { if (get().role !== role) set({ role }); return }
    get().stop()
    set({ teamId, userId, role, ready: false })

    // 1) 設定・進行中ジョブ・本日の利用枚数
    await get().refresh()
    // 投入者の表示名（メール）。失敗しても一覧は出す
    getTeamInfo().then((info) => {
      const names: Record<string, string> = {}
      for (const m of info.members) if (m.email) names[m.userId] = m.email
      set({ memberNames: names })
    }).catch(() => {})

    // 2) 中断した投入の再開（自分の uploading ジョブ・60 秒以上動きなし）。投入は冪等
    const now = Date.now()
    for (const job of get().activeJobs) {
      if (!isResumableJob(job, userId, now) || resuming.has(job.id)) continue
      resuming.add(job.id)
      submitJobFully(job.id).catch(() => {}).finally(() => { resuming.delete(job.id); get().bump() })
    }
    // 3) 照合（10 分以上「投入済み」のままのタスク）
    void get().reconcileNow(true)
    // 4) Realtime 購読は「追いたい画面がある or 進行中ジョブがある」間だけ（syncRealtime）。待機中は DB の WAL ポーリングを発生させない
    realtimeTeamId = teamId
    syncRealtime()
    // タブ復帰・再接続時: 取りこぼしを再取得＋照合。Realtime を諦めていれば間隔を空けて再挑戦
    visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return
      get().bump(); void get().reconcileNow()
      syncRealtime()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityHandler)
    if (typeof window !== 'undefined') window.addEventListener('online', visibilityHandler)
    pollTimer = setInterval(() => {
      const s = get()
      pollTick++
      if (!shouldSubscribeJobs(watchers.size, s.activeJobs.length)) return   // 追う画面も進行中ジョブも無ければ何もしない
      if (s.realtimeOk === false) s.bump()                       // Realtime なし: 15 秒ごと
      else if (s.activeJobs.length && pollTick % 2 === 0) s.bump() // Realtime あり: 進行中がある間 30 秒ごとの保険
    }, POLL_TICK_MS)
    set({ ready: true })
  },

  stop: () => {
    stopRealtime()
    realtimeTeamId = null
    gate = initialGate()
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (visibilityHandler) {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityHandler)
      if (typeof window !== 'undefined') window.removeEventListener('online', visibilityHandler)
      visibilityHandler = null
    }
    set({ teamId: null, userId: null, role: null, activeJobs: [], activeCount: 0, usedToday: 0, ready: false, realtimeOk: null, memberNames: {}, submitDialogNodeId: null })
  },

  refresh: async () => {
    const { teamId } = get()
    if (!teamId) return
    try {
      const [settings, activeJobs, limits] = await Promise.all([fetchTeamBatchSettings(teamId), fetchActiveJobs(teamId), fetchTeamBatchLimits()])
      if (get().teamId !== teamId) return
      // 利用枚数と進行中数はチーム全体（RPC）。RPC が無い環境では見えるジョブから数える
      const usedToday = limits ? limits.usedToday : await fetchUsedToday(teamId)
      const activeCount = limits ? limits.activeJobs : activeJobs.length
      set({ dailyLimit: limits?.dailyLimit ?? settings.dailyLimit, showCost: settings.showCost, activeJobs, usedToday, activeCount, jobsVersion: get().jobsVersion + 1 })
      syncRealtime()   // 進行中ジョブの有無で購読の要否が変わる
    } catch (e) {
      console.warn('[batch] refresh failed:', e)
    }
  },

  /** 変更通知をまとめて（300ms）再取得する */
  bump: () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { refreshTimer = null; void get().refresh() }, REFRESH_DEBOUNCE_MS)
  },

  reconcileNow: async (force = false) => {
    if (!get().teamId) return
    const now = Date.now()
    if (!force && now - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) return
    lastReconcileAt = now
    try {
      const r = await batchReconcile({})
      if (r.completed || r.failed || r.resubmitted) get().bump()
    } catch (e) {
      console.warn('[batch] reconcile failed:', e)
    }
  },

  openSubmitDialog: (nodeId) => set({ submitDialogNodeId: nodeId }),
  closeSubmitDialog: () => set({ submitDialogNodeId: null }),

  watch: (key) => { watchers.add(key); syncRealtime(); get().bump() },
  unwatch: (key) => { watchers.delete(key); syncRealtime() },
}))

/** ジョブ変更を追いたい画面で呼ぶ（マウント中だけ Realtime を購読する） */
export function useWatchBatchJobs(key: string): void {
  const watch = useBatchStore((s) => s.watch)
  const unwatch = useBatchStore((s) => s.unwatch)
  useEffect(() => { watch(key); return () => unwatch(key) }, [key, watch, unwatch])
}
