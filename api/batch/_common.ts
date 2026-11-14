// api/batch/* の Edge ラッパー共通部: env・JWT 検証・応答。
import { createClient } from '@supabase/supabase-js'
import { isOperator } from '../admin/_adminLogic'
import type { BatchOpts } from './_batchLogic'
import { cleanEnv } from '../../src/lib/env'
import { callerOf, mfaBlock, type Caller } from '../_auth'

export function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export interface BatchEnv { supabaseUrl: string; anonKey: string; serviceRoleKey: string; falKey: string; webhookBaseUrl: string | null; adminIds?: string }

export function readEnv(): BatchEnv | null {
  // 値は trim する（URL に埋め込む webhookBaseUrl などに改行が混ざると壊れる）
  const supabaseUrl = cleanEnv(process.env.VITE_SUPABASE_URL)
  const anonKey = cleanEnv(process.env.VITE_SUPABASE_ANON_KEY)
  const serviceRoleKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const falKey = cleanEnv(process.env.FAL_KEY)
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !falKey) return null
  const prodHost = cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL)
  const explicitBase = cleanEnv(process.env.BATCH_WEBHOOK_BASE_URL)
  const webhookBaseUrl = explicitBase || (prodHost ? `https://${prodHost}` : null)
  return { supabaseUrl, anonKey, serviceRoleKey, falKey, webhookBaseUrl, adminIds: process.env.ADMIN_USER_IDS }
}

/** Authorization: Bearer <JWT> を検証して呼び出し者（userId・保証レベル・要素の有無）を返す（無効なら null）。 */
export async function authCaller(req: Request, env: BatchEnv): Promise<Caller | null> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null
  const userSupabase = createClient(env.supabaseUrl, env.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error } = await userSupabase.auth.getUser(token)
  return error || !user ? null : callerOf(user, token)
}

export function batchOpts(env: BatchEnv, userId: string | null): BatchOpts {
  return { falKey: env.falKey, webhookBaseUrl: env.webhookBaseUrl, isAdmin: isOperator(userId, env.adminIds) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adminClient(env: BatchEnv): any {
  return createClient(env.supabaseUrl, env.serviceRoleKey)
}

/** 認証必須の POST ラッパー: env → JWT → body → core を呼ぶ。 */
export function authedPost(run: (admin: unknown, userId: string, opts: BatchOpts, body: unknown) => Promise<{ status: number; body: object }>) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
    const env = readEnv()
    if (!env) return jsonResponse({ error: 'Server configuration error' }, 500)
    const caller = await authCaller(req, env)
    if (!caller) return jsonResponse({ error: 'Forbidden' }, 403)
    const admin = adminClient(env)
    // 2 段階認証が必要なのに済んでいないセッションは通さない（2026-11-14・規則は src/lib/auth/mfaGate.ts）
    const blocked = await mfaBlock(admin, caller)
    if (blocked) return jsonResponse(blocked.body, blocked.status)
    let body: unknown
    try { body = await req.json() } catch { body = {} }
    const result = await run(admin, caller.userId, batchOpts(env, caller.userId), body)
    return jsonResponse(result.body, result.status)
  }
}
