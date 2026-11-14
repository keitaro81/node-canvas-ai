import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { configureFal } from '../lib/ai/fal-client'
import { useTeamStore } from './teamStore'
import { useMfaStore } from './mfaStore'


interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  /** パスワード再設定のリンクから来た（Account が「新しいパスワード」の案内を出す）。2 段階認証のコード入力をはさんでも残るようにここで持つ */
  passwordRecovery: boolean
  clearPasswordRecovery: () => void

  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  sendPasswordResetEmail: (email: string) => Promise<void>
  initialize: () => Promise<() => void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  passwordRecovery: false,
  clearPasswordRecovery: () => set({ passwordRecovery: false }),

  signInWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  },

  signUpWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  },

  signInWithGoogle: async () => {
    const callbackUrl = `${window.location.origin}/auth/callback.html`
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl,
        skipBrowserRedirect: true,
      },
    })
    if (error) throw error
    if (!data.url) throw new Error('Google認証URLを取得できませんでした')

    const popup = window.open(data.url, 'google-auth', 'width=500,height=600,left=400,top=200')
    if (!popup) throw new Error('ポップアップがブロックされました。ブラウザの設定を確認してください。')

    // callback.html が postMessage でコールバックURLを送ってくるのを待ち、セッションを確立する
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage)
        reject(new Error('認証がタイムアウトしました'))
      }, 120_000)

      async function onMessage(event: MessageEvent) {
        if (event.origin !== window.location.origin) return
        if (event.data?.type !== 'supabase:callback') return

        window.removeEventListener('message', onMessage)
        clearTimeout(timeout)

        try {
          const url = new URL(event.data.url as string)

          // PKCE フロー: ?code=
          const code = url.searchParams.get('code')
          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code)
            if (error) throw error
            resolve()
            return
          }

          // Implicit フロー: #access_token=&refresh_token=
          const hash = new URLSearchParams(url.hash.slice(1))
          const access_token = hash.get('access_token')
          const refresh_token = hash.get('refresh_token')
          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({ access_token, refresh_token })
            if (error) throw error
            resolve()
            return
          }

          reject(new Error('セッション情報が取得できませんでした'))
        } catch (err) {
          reject(err)
        }
      }

      window.addEventListener('message', onMessage)
    })
  },

  updatePassword: async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  },

  sendPasswordResetEmail: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/account`,
    })
    if (error) throw error
  },

  signOut: async () => {
    // scope=local でこのデバイスのセッションのみ削除。
    // サーバー側が403を返してもローカル状態は必ずクリアする。
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    useTeamStore.getState().clear()
    useMfaStore.getState().reset()
    set({ user: null, session: null, passwordRecovery: false })
  },

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    configureFal(session?.access_token ?? null)
    set({ user: session?.user ?? null, session, loading: false })
    // 所属チーム・当月消費をロード（クォータ表示用）。失敗してもアプリは止めない。
    if (session?.user) void useTeamStore.getState().loadTeamContext()
    // 2 段階認証の判定（AuthGuard が見る）
    if (session?.user) void useMfaStore.getState().refresh()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      configureFal(session?.access_token ?? null)
      set({ user: session?.user ?? null, session })
      if (event === 'PASSWORD_RECOVERY') set({ passwordRecovery: true })
      // 2 段階目を通した直後のトークンを Realtime にも渡す。supabase-js が Realtime に渡すのは SIGNED_IN と
      // TOKEN_REFRESHED のときだけなので、そのままだと次のトークン更新（最長 1 時間後）まで 1 段階目のトークンで
      // 購読が続き、mfa_gate（0023）で変更通知（一括処理の進行・編集ロック）が届かない
      if (event === 'MFA_CHALLENGE_VERIFIED' && session?.access_token) {
        void supabase.realtime.setAuth(session.access_token).catch(() => { /* 次のトークン更新で渡る */ })
      }
      if (session?.user) void useTeamStore.getState().loadTeamContext()
      else useTeamStore.getState().clear()
      // 2 段階認証の判定を取り直す。このコールバックの中で auth を呼ぶと詰まることがあるので、抜けてから呼ぶ。
      // コード入力の直後・ユーザー情報の更新は必ず問い合わせ、それ以外（タブに戻った・トークン更新）は間引く
      if (!session?.user) useMfaStore.getState().reset()
      else setTimeout(() => { void useMfaStore.getState().refresh(event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') }, 0)
    })

    return () => subscription.unsubscribe()
  },
}))
