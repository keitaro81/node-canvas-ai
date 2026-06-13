import { create } from 'zustand'
import { getMyTeamContext, type TeamContext } from '../lib/api/teams'

interface TeamState {
  context: TeamContext | null
  loading: boolean
  /** 所属チームと当月消費を取得して保持する。ログイン確立時・生成後に呼ぶ。 */
  loadTeamContext: () => Promise<void>
  /** ログアウト時にクリアする。 */
  clear: () => void
}

export const useTeamStore = create<TeamState>((set) => ({
  context: null,
  loading: false,

  loadTeamContext: async () => {
    set({ loading: true })
    try {
      const context = await getMyTeamContext()
      set({ context, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  clear: () => set({ context: null }),
}))
