import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { configureFal } from '../lib/ai/fal-client'

// アプリ起動時に一度だけfal clientを設定する
configureFal()

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean

  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  initialize: () => Promise<() => void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,

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

  signOut: async () => {
    // scope=local でこのデバイスのセッションのみ削除。
    // サーバー側が403を返してもローカル状態は必ずクリアする。
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    set({ user: null, session: null })
  },

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    set({ user: session?.user ?? null, session, loading: false })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null, session })
    })

    return () => subscription.unsubscribe()
  },
}))
