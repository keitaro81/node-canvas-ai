import { describe, it, expect } from 'vitest'
import { appRootOf, isAllowedTarget, isBgRemovalPath, modelPathOf } from './_allowlist'
import { classifyGeneration } from './_proxyLogic'

// fal エンドポイント allowlist の回帰テスト。
// ⚠️ 「既存で使っている全モデル」が許可されることをここで固定する（漏れると本番の生成が 400 で止まる）。
const EXISTING_ENDPOINTS = [
  // 画像
  'fal-ai/nano-banana-2', 'fal-ai/nano-banana-pro', 'fal-ai/flux-2',
  'black-forest-labs/flux-schnell', 'black-forest-labs/flux-dev', 'black-forest-labs/flux-1.1-pro',
  'fal-ai/recraft/v4/text-to-image', 'fal-ai/recraft/v4/pro/text-to-image',
  'openai/gpt-image-2', 'openai/gpt-image-2/edit',
  'fal-ai/nano-banana-2/edit', 'fal-ai/nano-banana-pro/edit',
  // 動画
  'fal-ai/ltx-2.3/text-to-video/fast', 'fal-ai/ltx-2.3/image-to-video/fast',
  'fal-ai/ltx-2.3/text-to-video', 'fal-ai/ltx-2.3/image-to-video',
  'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  'fal-ai/kling-video/v3/pro/text-to-video', 'fal-ai/kling-video/v3/pro/image-to-video',
  'fal-ai/kling-video/o3/pro/image-to-video',
  'fal-ai/kling-video/o3/standard/video-to-video/reference', 'fal-ai/kling-video/o3/pro/video-to-video/reference',
  // LLM / 解析
  'fal-ai/any-llm', 'fal-ai/llava-next',
  // 撮影後工程（切り抜き候補）
  'fal-ai/bria/background/remove', 'fal-ai/birefnet/v2',
]

const q = (path: string) => new URL(`https://queue.fal.run/${path}`)

describe('isAllowedTarget', () => {
  it('既存で使う全エンドポイントを queue ホストで許可する', () => {
    for (const p of EXISTING_ENDPOINTS) expect(isAllowedTarget(q(p)), p).toBe(true)
  })

  it('queue の poll/result/cancel（/requests/<id>/...）も許可する', () => {
    expect(isAllowedTarget(q('fal-ai/flux-2/requests/abc123'))).toBe(true)
    expect(isAllowedTarget(q('fal-ai/flux-2/requests/abc123/status'))).toBe(true)
    expect(isAllowedTarget(q('fal-ai/kling-video/v3/pro/text-to-video/requests/x/cancel'))).toBe(true)
  })

  // ⚠️ 回帰: fal クライアントは状態取得/結果/キャンセルを「サブパスを落としたアプリ root」で発行する
  // （fal-ai/recraft/v4/text-to-image → fal-ai/recraft/requests/<id>/status）。ここが弾かれると投入は通るのに
  // 完了を待てず、生成が失敗する（2026-09-21 に recraft/bria で実際に発生）。
  it('既存全エンドポイントのアプリ root 配下の requests URL（status/stream/result/cancel）を許可する', () => {
    for (const p of EXISTING_ENDPOINTS) {
      const root = appRootOf(p)
      expect(isAllowedTarget(q(`${root}/requests/req-1/status`)), `${p} → ${root} status`).toBe(true)
      expect(isAllowedTarget(q(`${root}/requests/req-1/status/stream`)), `${p} → ${root} stream`).toBe(true)
      expect(isAllowedTarget(q(`${root}/requests/req-1`)), `${p} → ${root} result`).toBe(true)
      expect(isAllowedTarget(q(`${root}/requests/req-1/cancel`)), `${p} → ${root} cancel`).toBe(true)
    }
    // 具体例（サブパス付きモデル）
    expect(appRootOf('fal-ai/recraft/v4/text-to-image')).toBe('fal-ai/recraft')
    expect(isAllowedTarget(q('fal-ai/recraft/requests/abc/status'))).toBe(true)
    expect(isAllowedTarget(q('fal-ai/bria/requests/abc'))).toBe(true)
  })

  it('アプリ root の緩和は requests エンドポイントに限る（root 配下の未登録モデルへの投入は拒否）', () => {
    expect(isAllowedTarget(q('fal-ai/recraft/v3/text-to-image'))).toBe(false)
    expect(isAllowedTarget(q('fal-ai/bria/text-to-image/base'))).toBe(false)
    expect(isAllowedTarget(q('fal-ai/unknown/requests/abc/status'))).toBe(false)
    expect(isAllowedTarget(q('fal-ai/requests/abc/status'))).toBe(false)
  })

  it('同期ホスト fal.run でも同じモデル allowlist が効く', () => {
    expect(isAllowedTarget(new URL('https://fal.run/fal-ai/nano-banana-2'))).toBe(true)
    expect(isAllowedTarget(new URL('https://fal.run/fal-ai/some-unknown-model'))).toBe(false)
  })

  it('アップロード/状態取得ホストはパス制限なし', () => {
    expect(isAllowedTarget(new URL('https://rest.fal.run/storage/upload/initiate'))).toBe(true)
    expect(isAllowedTarget(new URL('https://storage.fal.run/files/x'))).toBe(true)
  })

  it('未登録モデル・プレフィックスの誤マッチ・外部ホストは拒否', () => {
    expect(isAllowedTarget(q('fal-ai/some-random-model'))).toBe(false)
    expect(isAllowedTarget(q('fal-ai/nano-banana-2x'))).toBe(false)      // 'nano-banana-2' + '/' でないので拒否
    expect(isAllowedTarget(q('fal-ai/flux-2-evil'))).toBe(false)
    expect(isAllowedTarget(new URL('https://evil.example.com/fal-ai/flux-2'))).toBe(false)
    expect(isAllowedTarget(new URL('https://queue.fal.run.evil.com/fal-ai/flux-2'))).toBe(false)
  })
})

describe('classifyGeneration（クォータ分類）', () => {
  it('画像/動画の submit は課金対象', () => {
    expect(classifyGeneration('POST', q('fal-ai/nano-banana-2'))).toBe('image')
    expect(classifyGeneration('POST', q('fal-ai/ltx-2.3/text-to-video/fast'))).toBe('video')
    expect(classifyGeneration('POST', new URL('https://fal.run/fal-ai/flux-2'))).toBe('image')
  })

  it('背景切り抜きは月次画像クォータの対象外（別建て）', () => {
    expect(isBgRemovalPath('fal-ai/bria/background/remove')).toBe(true)
    expect(isBgRemovalPath('fal-ai/birefnet/v2')).toBe(true)
    expect(isBgRemovalPath('fal-ai/nano-banana-2')).toBe(false)
    expect(classifyGeneration('POST', q('fal-ai/bria/background/remove'))).toBeNull()
    expect(classifyGeneration('POST', q('fal-ai/birefnet/v2'))).toBeNull()
  })

  it('poll/LLM/GET/アップロードは対象外', () => {
    expect(classifyGeneration('GET', q('fal-ai/flux-2/requests/x'))).toBeNull()
    expect(classifyGeneration('POST', q('fal-ai/flux-2/requests/x/cancel'))).toBeNull()
    expect(classifyGeneration('POST', q('fal-ai/any-llm'))).toBeNull()
    expect(classifyGeneration('POST', new URL('https://rest.fal.run/storage/upload'))).toBeNull()
  })

  it('modelPathOf は先頭の / を除く', () => {
    expect(modelPathOf(q('fal-ai/flux-2'))).toBe('fal-ai/flux-2')
  })
})
