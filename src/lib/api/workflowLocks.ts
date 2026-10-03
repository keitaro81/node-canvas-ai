// 編集ロック（フェーズ B）の API。取得/更新/解放は 0017 の RPC、閲覧はテーブル（RLS: ワークフローが見える人）。
import { supabase } from '../supabase'
import { cleanEnv } from '../env'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { AcquireResult, EditLockRow } from '../workflow/editLock'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any

/** 取得（p_heartbeat=false）/ 更新（true）。失敗時は forbidden 扱い（画面は閲覧のみ） */
export async function acquireEditLock(workflowId: string, sessionId: string, heartbeat = false): Promise<AcquireResult> {
  const { data, error } = await sb.rpc('acquire_workflow_edit_lock', { p_workflow_id: workflowId, p_session_id: sessionId, p_heartbeat: heartbeat })
  if (error || !data || typeof data !== 'object') return { ok: false, reason: 'forbidden' }
  return data as AcquireResult
}

export async function releaseEditLock(workflowId: string, sessionId: string): Promise<boolean> {
  const { data, error } = await sb.rpc('release_workflow_edit_lock', { p_workflow_id: workflowId, p_session_id: sessionId })
  return !error && data === true
}

// タブを閉じるときの解放（keepalive）。supabase-js は keepalive を付けられないので REST を直接呼ぶ。トークンはセッションから取り出す
let cachedToken: string | null = null
void supabase.auth.getSession().then(({ data }) => { cachedToken = data.session?.access_token ?? null })
supabase.auth.onAuthStateChange((_e, session) => { cachedToken = session?.access_token ?? null })
export function releaseEditLockOnUnload(workflowId: string, sessionId: string): void {
  const url = cleanEnv(import.meta.env.VITE_SUPABASE_URL), anon = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)
  if (!url || !anon || !cachedToken) return
  try {
    void fetch(`${url}/rest/v1/rpc/release_workflow_edit_lock`, {
      method: 'POST', keepalive: true,
      headers: { apikey: anon, Authorization: `Bearer ${cachedToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_workflow_id: workflowId, p_session_id: sessionId }),
    })
  } catch { /* ベストエフォート（90 秒で失効する） */ }
}

/** 現在のロック行（無ければ null。RLS で読めなくても null） */
export async function fetchEditLock(workflowId: string): Promise<EditLockRow | null> {
  const { data, error } = await sb.from('workflow_edit_locks').select('workflow_id, user_id, user_email, session_id, acquired_at, heartbeat_at').eq('workflow_id', workflowId).maybeSingle()
  if (error || !data) return null
  return data as EditLockRow
}

let seq = 0
/** ロック行の変化を購読（INSERT/UPDATE → 行、DELETE → null）。status で購読の成否を知らせる */
export function subscribeEditLock(workflowId: string, onRow: (row: EditLockRow | null) => void, onStatus?: (status: string) => void): () => void {
  const ch: RealtimeChannel = supabase
    .channel(`wf-edit-lock:${workflowId}:${++seq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_edit_locks', filter: `workflow_id=eq.${workflowId}` }, (payload) => {
      if (payload.eventType === 'DELETE') { onRow(null); return }
      const row = payload.new as unknown as EditLockRow
      if (row && row.workflow_id) onRow(row)
    })
    .subscribe((status) => onStatus?.(status))
  return () => { void supabase.removeChannel(ch) }
}
