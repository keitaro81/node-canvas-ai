import { describe, it, expect } from 'vitest'
import { toStoragePath, toCanonicalRef } from './storage'

// L1/L2 のメディア URL 解析。ここが崩れると「私有バケットの誤署名」「公開URLの取りこぼし」に直結するため
// 回帰テストで固定する。純関数（ネットワーク・秘密情報なし）。
describe('toStoragePath', () => {
  it('公開形式 /object/public/<bucket>/<path> を抽出', () => {
    expect(toStoragePath('https://x.supabase.co/storage/v1/object/public/generated-images/node-1/img.png'))
      .toEqual({ bucket: 'generated-images', path: 'node-1/img.png' })
  })

  it('署名形式 /object/sign/<bucket>/<path>?token=... を抽出（token は除去）', () => {
    expect(toStoragePath('https://x.supabase.co/storage/v1/object/sign/generated-videos/n/v.mp4?token=abc.def'))
      .toEqual({ bucket: 'generated-videos', path: 'n/v.mp4' })
  })

  it('パスの percent-encoding をデコードする', () => {
    expect(toStoragePath('https://x.supabase.co/storage/v1/object/public/generated-images/node%201/a%2Bb.png'))
      .toEqual({ bucket: 'generated-images', path: 'node 1/a+b.png' })
  })

  it('私有バケット以外は null（誤って署名対象にしない）', () => {
    expect(toStoragePath('https://x.supabase.co/storage/v1/object/public/public-media/x.png')).toBeNull()
    expect(toStoragePath('https://x.supabase.co/storage/v1/object/public/avatars/x.png')).toBeNull()
  })

  it('外部/一時URL・スキームは対象外（素通し＝null）', () => {
    expect(toStoragePath('https://fal.media/files/x.png')).toBeNull()
    expect(toStoragePath('blob:http://localhost:5173/uuid')).toBeNull()
    expect(toStoragePath('data:image/png;base64,AAAA')).toBeNull()
    expect(toStoragePath('https://example.com/img.png')).toBeNull()
  })

  it('null / undefined / 空 / 非文字列は null', () => {
    expect(toStoragePath(null)).toBeNull()
    expect(toStoragePath(undefined)).toBeNull()
    expect(toStoragePath('')).toBeNull()
    // @ts-expect-error 型外入力の防御
    expect(toStoragePath(123)).toBeNull()
  })

  it('bucket の後にパスが無い形は null', () => {
    expect(toStoragePath('https://x.supabase.co/storage/v1/object/public/generated-images')).toBeNull()
    expect(toStoragePath('https://x.supabase.co/storage/v1/object/public/generated-images/')).toBeNull()
  })
})

describe('toCanonicalRef', () => {
  it('署名URL → canonical な公開URL（token / sign を含まない）', () => {
    const out = toCanonicalRef('https://x.supabase.co/storage/v1/object/sign/generated-images/node-1/img.png?token=abc.def')
    expect(out).toContain('/object/public/generated-images/node-1/img.png')
    expect(out).not.toContain('/object/sign/')
    expect(out).not.toContain('?token=')
  })

  it('既に公開URLならそのまま canonical（パスを保持）', () => {
    const out = toCanonicalRef('https://x.supabase.co/storage/v1/object/public/generated-images/node-1/img.png')
    expect(out).toContain('/object/public/generated-images/node-1/img.png')
  })

  it('対象外（fal/blob/外部/null/undefined）は素通し', () => {
    expect(toCanonicalRef('https://fal.media/files/x.png')).toBe('https://fal.media/files/x.png')
    expect(toCanonicalRef('blob:http://localhost:5173/uuid')).toBe('blob:http://localhost:5173/uuid')
    expect(toCanonicalRef('https://example.com/img.png')).toBe('https://example.com/img.png')
    expect(toCanonicalRef(null)).toBeNull()
    expect(toCanonicalRef(undefined)).toBeUndefined()
  })
})
