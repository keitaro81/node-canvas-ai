import { describe, it, expect, afterEach, vi } from 'vitest'
import { falProxyCore } from './_proxyLogic'
import { FAL_OBJECT_LIFECYCLE_HEADER, FAL_STORE_IO_HEADER } from './_privacy'
import { falSubmit, falStatus } from '../batch/_batchLogic'
import { llmCompleteServer } from './_llm'

// fal へ依頼を出す 3 つの入口（プロキシ・一括処理・LLM）が、生成物ファイルの期限の指定を付けていること（メモ 83）。
// どれか 1 つでも外れると、その経路の生成物が fal 側に残り続ける。入出力も保存しない指定（FAL_STORE_IO=0）は既定では付けない。

/** fetch を差し替えて、fal に送ったヘッダーを記録する */
function captureFetch(respond: () => Response = () => new Response(JSON.stringify({ request_id: 'r1', status: 'IN_QUEUE' }), { status: 200, headers: { 'Content-Type': 'application/json' } })) {
  const calls: Array<{ url: string; method: string; headers: Headers }> = []
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers) })
    return respond()
  })
  return calls
}

/** クォータの判定に答えるだけの service role クライアント（上限に余裕あり） */
function quotaAdmin() {
  const incremented: string[] = []
  const table = (name: string) => {
    const q: Record<string, unknown> = {}
    const chain = () => q
    Object.assign(q, {
      select: chain, eq: chain, limit: chain,
      maybeSingle: async () => ({ data: name === 'team_members' ? { team_id: 't1' } : { quota_image_monthly: 100, quota_video_monthly: 7 } }),
      then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] }),   // usage_counters の一覧
    })
    return q
  }
  return { from: table, rpc: async (_fn: string, args: { p_kind: string }) => { incremented.push(args.p_kind); return { error: null } }, incremented }
}

const lifecycleOf = (h: Headers) => JSON.parse(h.get(FAL_OBJECT_LIFECYCLE_HEADER) ?? 'null')

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('fal プロキシ: 生成の依頼に、生成物ファイルの期限を付ける', () => {
  const base = { userId: 'u1', falKey: 'server-key', contentType: 'application/json', accept: 'application/json' }

  it('生成の投入: 生成物のファイルは 7 日。入出力を保存しない指定は付けない（復旧を優先）。鍵はサーバーのもの', async () => {
    const calls = captureFetch()
    const admin = quotaAdmin()
    const res = await falProxyCore({ ...base, admin, method: 'POST', targetUrl: 'https://queue.fal.run/google/nano-banana-2.1/edit', body: '{"prompt":"p"}' })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(lifecycleOf(calls[0].headers)).toEqual({ expiration_duration_seconds: 604800 })
    expect(calls[0].headers.get(FAL_STORE_IO_HEADER)).toBeNull()
    expect(calls[0].headers.get('Authorization')).toBe('Key server-key')
    expect(admin.incremented).toEqual(['image'])   // クォータの記帳は今までどおり
  })

  it('クォータの対象外の依頼（LLM・切り抜き）にも付ける', async () => {
    const calls = captureFetch()
    const admin = quotaAdmin()
    await falProxyCore({ ...base, admin, method: 'POST', targetUrl: 'https://fal.run/openrouter/router', body: '{}' })
    await falProxyCore({ ...base, admin, method: 'POST', targetUrl: 'https://queue.fal.run/fal-ai/bria/background/remove', body: '{}' })
    expect(calls.map((c) => lifecycleOf(c.headers)?.expiration_duration_seconds)).toEqual([604800, 604800])
    expect(admin.incremented).toEqual([])
  })

  it('状態の確認・結果の取得・アップロードには付けない（投入だけ）', async () => {
    const calls = captureFetch()
    const admin = quotaAdmin()
    await falProxyCore({ ...base, admin, method: 'GET', targetUrl: 'https://queue.fal.run/google/nano-banana-2.1/requests/abc/status' })
    await falProxyCore({ ...base, admin, method: 'GET', targetUrl: 'https://queue.fal.run/openai/gpt-image-2.6/requests/abc' })
    await falProxyCore({ ...base, admin, method: 'POST', targetUrl: 'https://rest.fal.run/storage/upload/initiate', body: '{}' })
    expect(calls).toHaveLength(3)
    for (const c of calls) {
      expect(c.headers.get(FAL_STORE_IO_HEADER)).toBeNull()
      expect(c.headers.get(FAL_OBJECT_LIFECYCLE_HEADER)).toBeNull()
    }
  })

  it("環境変数 FAL_STORE_IO=0 のときは、入出力も保存しない指定を足す（期限の指定はそのまま）", async () => {
    vi.stubEnv('FAL_STORE_IO', '0')
    const calls = captureFetch()
    await falProxyCore({ ...base, admin: quotaAdmin(), method: 'POST', targetUrl: 'https://queue.fal.run/google/nano-banana-2.1/edit', body: '{}' })
    expect(calls[0].headers.get(FAL_STORE_IO_HEADER)).toBe('0')
    expect(lifecycleOf(calls[0].headers)).toEqual({ expiration_duration_seconds: 604800 })
  })

  it('環境変数 FAL_MEDIA_TTL_SECONDS で期限を変えられる', async () => {
    vi.stubEnv('FAL_MEDIA_TTL_SECONDS', '86400')
    const calls = captureFetch()
    await falProxyCore({ ...base, admin: quotaAdmin(), method: 'POST', targetUrl: 'https://queue.fal.run/google/nano-banana-2.1', body: '{}' })
    expect(lifecycleOf(calls[0].headers)).toEqual({ expiration_duration_seconds: 86400 })
  })

  it('許可していない宛先には何も送らない', async () => {
    const calls = captureFetch()
    const res = await falProxyCore({ ...base, admin: quotaAdmin(), method: 'POST', targetUrl: 'https://example.com/steal', body: '{}' })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('一括処理と LLM の入口にも付いている', () => {
  it('一括処理の投入（falSubmit）: 付く。状態の確認（falStatus）: 付かない', async () => {
    const calls = captureFetch()
    const r = await falSubmit('server-key', 'google/nano-banana-2.1/edit', { prompt: 'p' }, 'https://app.example.com/api/batch/webhook?t=1')
    expect(r).toEqual({ requestId: 'r1' })
    await falStatus('server-key', 'google/nano-banana-2.1/edit', 'r1')
    expect(calls[0].method).toBe('POST')
    expect(lifecycleOf(calls[0].headers)).toEqual({ expiration_duration_seconds: 604800 })
    expect(calls[0].headers.get(FAL_STORE_IO_HEADER)).toBeNull()
    expect(calls[1].method).toBe('GET')
    expect(calls[1].url).toBe('https://queue.fal.run/google/nano-banana-2.1/requests/r1/status')   // 状態の確認先は <owner>/<alias>/requests/<id>
    expect(calls[1].headers.get(FAL_OBJECT_LIFECYCLE_HEADER)).toBeNull()
  })

  it('サーバーからの LLM 呼び出し: 既定では保存しない指定は付かない。FAL_STORE_IO=0 なら付く（プロンプトや翻訳する文を残さない）', async () => {
    const seen: Headers[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return new Response(JSON.stringify({ output: 'OUT' }), { status: 200 })
    }) as typeof fetch
    await llmCompleteServer('server-key', { models: ['m'], prompt: 'p' }, fetchImpl)
    expect(seen).toHaveLength(1)
    expect(seen[0].get(FAL_STORE_IO_HEADER)).toBeNull()
    expect(seen[0].get('Authorization')).toBe('Key server-key')
    vi.stubEnv('FAL_STORE_IO', '0')
    await llmCompleteServer('server-key', { models: ['m'], prompt: 'p' }, fetchImpl)
    expect(seen[1].get(FAL_STORE_IO_HEADER)).toBe('0')
  })
})
