import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useTeamStore } from '../../stores/teamStore'
import { useBatchStore } from '../../stores/batchStore'

/**
 * アプリを開いた時の処理（仕様 4-8）を 1 か所で起動する: 進行中ジョブの取得 → 中断した投入の再開 → 照合 → Realtime 購読。
 * ログイン確立とチーム取得の後に動き、ログアウトで止める。描画はしない。
 */
export function BatchSync() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const teamId = useTeamStore((s) => s.context?.teamId ?? null)
  const role = useTeamStore((s) => s.context?.role ?? null)
  useEffect(() => {
    if (userId && teamId && role) void useBatchStore.getState().start(teamId, userId, role)
    else if (!userId) useBatchStore.getState().stop()
  }, [userId, teamId, role])
  return null
}
