// 一括実行（バッチ）のクライアント状態（仕様 4-8）:
// 進行中ジョブ・本日の利用枚数・上限・原価表示の可否・Realtime 購読・アプリを開いた時の再開と照合。
// 一覧ページは jobsVersion の変化で現在ページを再取得する（Realtime のイベントを行にマージしない）。
import { create } from 'zustand'
import type { BatchJobRow } from '../types/batch'
import { fetchActiveJobs, fetchTeamBatchSettings, fetchUsedToday, subscribeTeamJobs } from '../lib/api/batchJobs'
import { batchReconcile, submitJobFully } from '../lib/api/batch'
import { getTeamInfo } from '../lib/api/team'
import { isResumableJob } from '../lib/batch/jobsQuery'

const RECONCILE_MIN_INTERVAL_MS = 60_000
const REFRESH_DEBOUNCE_MS = 300
const ACTIVE_POLL_MS = 30_000          // Realtime が届かない環境の保険（進行中ジョブがある間だけ）

interface BatchState {
  teamId: string | null
  userId: string | null
  role: 'owner' | 'member' | null
  dailyLimit: number
  showCost: boolean
  usedToday: number
  activeJobs: BatchJobRow[]
  jobsVersion: number
  memberNames: Record<string, string>
  ready: boolean
  submitDialogNodeId: string | null

  start: (teamId: string, userId: string, role: 'owner' | 'member') => Promise<void>
  stop: () => void
  refresh: () => Promise<void>
  bump: () => void
  reconcileNow: (force?: boolean) => Promise<void>
  openSubmitDialog: (nodeId: string) => void
  closeSubmitDialog: () => void
}

let unsubscribe: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let lastReconcileAt = 0
let visibilityHandler: (() => void) | null = null
const resuming = new Set<string>()

export const useBatchStore = create<BatchState>((set, get) => ({
  teamId: null,
  userId: null,
  role: null,
  dailyLimit: 300,
  showCost: false,
  usedToday: 0,
  activeJobs: [],
  jobsVersion: 0,
  memberNames: {},
  ready: false,
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
    // 4) Realtime 購読（自チームの batch_jobs）
    unsubscribe = subscribeTeamJobs(teamId, () => get().bump())
    // タブ復帰・再接続時: 取りこぼしを再取得＋照合
    visibilityHandler = () => { if (document.visibilityState === 'visible') { get().bump(); void get().reconcileNow() } }
    document.addEventListener('visibilitychange', visibilityHandler)
    window.addEventListener('online', visibilityHandler)
    pollTimer = setInterval(() => { if (get().activeJobs.length) get().bump() }, ACTIVE_POLL_MS)
    set({ ready: true })
  },

  stop: () => {
    unsubscribe?.(); unsubscribe = null
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); window.removeEventListener('online', visibilityHandler); visibilityHandler = null }
    set({ teamId: null, userId: null, role: null, activeJobs: [], usedToday: 0, ready: false, memberNames: {}, submitDialogNodeId: null })
  },

  refresh: async () => {
    const { teamId } = get()
    if (!teamId) return
    try {
      const [settings, activeJobs, usedToday] = await Promise.all([fetchTeamBatchSettings(teamId), fetchActiveJobs(teamId), fetchUsedToday(teamId)])
      if (get().teamId !== teamId) return
      set({ dailyLimit: settings.dailyLimit, showCost: settings.showCost, activeJobs, usedToday, jobsVersion: get().jobsVersion + 1 })
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
}))
