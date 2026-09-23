// Realtime 購読の見張り（純関数）: 接続できない環境（WebSocket 遮断・鍵の不一致など）で
// supabase-js の再接続ループを止め、定期的な再取得に切り替える判断をする。
export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'

export interface GateState { subscribed: boolean; failures: number; gaveUp: boolean }

export const MAX_REALTIME_FAILURES = 3

export const initialGate = (): GateState => ({ subscribed: false, failures: 0, gaveUp: false })

/**
 * 状態通知を畳み込む。SUBSCRIBED で回復（失敗数リセット）。
 * 一度も購読できないまま失敗が MAX 回続いたら諦める。一度つながった後の切断は supabase-js の再接続に任せる（諦めない）。
 */
export function nextGate(g: GateState, status: ChannelStatus): GateState {
  if (g.gaveUp) return g
  if (status === 'SUBSCRIBED') return { subscribed: true, failures: 0, gaveUp: false }
  const failures = g.failures + 1
  return { subscribed: g.subscribed, failures, gaveUp: !g.subscribed && failures >= MAX_REALTIME_FAILURES }
}
