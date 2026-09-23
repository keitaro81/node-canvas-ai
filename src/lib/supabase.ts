import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { cleanEnv } from './env'

// 末尾の改行などを落とす（Realtime は apikey を URL に載せるため、混入すると接続できない）
const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

if (!supabaseUrl || !supabaseAnonKey) {
  if (import.meta.env.DEV) {
    console.warn('[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. Auth and data features will not work.')
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
