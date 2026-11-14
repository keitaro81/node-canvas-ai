import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FAL_MEDIA_TTL_SECONDS, FAL_OBJECT_LIFECYCLE_HEADER, FAL_STORE_IO_HEADER, MIN_FAL_MEDIA_TTL_SECONDS,
  falMediaTtlSeconds, falPrivacyHeaders, falSkipsPayloadStorage, isFalSubmit,
} from './_privacy'

// fal 側に生成物を置きっぱなしにしないための指定（メモ 83）。ここが外れると、生成物のファイルが fal に残り続ける。
describe('fal に付けるヘッダー（生成物のファイルは期限つき）', () => {
  it('既定: 生成物のファイルは 7 日後に消す。入出力の保存は fal の既定のまま（保存しない指定は付けない = 復旧を優先）', () => {
    const h = falPrivacyHeaders('', '')
    expect(JSON.parse(h[FAL_OBJECT_LIFECYCLE_HEADER])).toEqual({ expiration_duration_seconds: 7 * 24 * 60 * 60 })
    expect(h[FAL_STORE_IO_HEADER]).toBeUndefined()
    expect(Object.keys(h)).toEqual([FAL_OBJECT_LIFECYCLE_HEADER])
  })

  it('環境変数で期限を変えられる。1 時間より短くはしない', () => {
    expect(falMediaTtlSeconds('86400')).toBe(86400)
    expect(falMediaTtlSeconds(' 86400\n')).toBe(86400)            // Vercel の環境変数に混ざる末尾の改行
    expect(falMediaTtlSeconds('60')).toBe(MIN_FAL_MEDIA_TTL_SECONDS)
    expect(JSON.parse(falPrivacyHeaders('3600', '')[FAL_OBJECT_LIFECYCLE_HEADER])).toEqual({ expiration_duration_seconds: 3600 })
  })

  it('読めない値は既定に戻す（書き間違いで「残し続ける」にしない）', () => {
    for (const bad of ['abc', '0', '-5', 'NaN', '1d']) expect(falMediaTtlSeconds(bad)).toBe(DEFAULT_FAL_MEDIA_TTL_SECONDS)
    expect(falMediaTtlSeconds(undefined)).toBe(DEFAULT_FAL_MEDIA_TTL_SECONDS)
    expect(falMediaTtlSeconds(null)).toBe(DEFAULT_FAL_MEDIA_TTL_SECONDS)
  })

  it("'off' のときだけ期限を付けない", () => {
    expect(falMediaTtlSeconds('off')).toBeNull()
    expect(falMediaTtlSeconds('OFF')).toBeNull()
    expect(falPrivacyHeaders('off', '')).toEqual({})
  })

  it("入出力も保存しない指定は、環境変数 FAL_STORE_IO が '0' のときだけ付く（結果が約 1 時間で消える引き換えがあるので既定では付けない）", () => {
    expect(falSkipsPayloadStorage('0')).toBe(true)
    expect(falSkipsPayloadStorage(' 0\n')).toBe(true)
    for (const v of ['', '1', 'off', 'false', undefined, null]) expect(falSkipsPayloadStorage(v)).toBe(false)
    const h = falPrivacyHeaders('', '0')
    expect(h[FAL_STORE_IO_HEADER]).toBe('0')
    expect(JSON.parse(h[FAL_OBJECT_LIFECYCLE_HEADER])).toEqual({ expiration_duration_seconds: DEFAULT_FAL_MEDIA_TTL_SECONDS })
  })
})

describe('生成の依頼（投入）の見分け', () => {
  const u = (s: string) => new URL(s)
  it('queue / 同期ホストへの POST は投入', () => {
    expect(isFalSubmit('POST', u('https://queue.fal.run/google/nano-banana-2.1/edit'))).toBe(true)
    expect(isFalSubmit('post', u('https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video?fal_webhook=https%3A%2F%2Fexample.com'))).toBe(true)
    expect(isFalSubmit('POST', u('https://fal.run/openrouter/router'))).toBe(true)
    expect(isFalSubmit('POST', u('https://queue.fal.run/fal-ai/bria/background/remove'))).toBe(true)
  })

  it('状態の確認・結果の取得・取り消し・アップロードは投入ではない', () => {
    expect(isFalSubmit('GET', u('https://queue.fal.run/google/nano-banana-2.1/requests/abc/status'))).toBe(false)
    expect(isFalSubmit('GET', u('https://queue.fal.run/google/nano-banana-2.1/requests/abc'))).toBe(false)
    expect(isFalSubmit('PUT', u('https://queue.fal.run/google/nano-banana-2.1/requests/abc/cancel'))).toBe(false)
    expect(isFalSubmit('POST', u('https://queue.fal.run/google/nano-banana-2.1/requests/abc/cancel'))).toBe(false)
    expect(isFalSubmit('POST', u('https://rest.fal.run/storage/upload/initiate'))).toBe(false)
  })
})
