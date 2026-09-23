import { describe, it, expect } from 'vitest'
import { batchPathTeam } from './_signMediaLogic'

// batch バケットのパス → team_id 判定。ここが緩むと他チームのファイルを署名できてしまう。
describe('batchPathTeam', () => {
  const T = '11111111-2222-4333-8444-555555555555'

  it('<team_id>/<job>/<item>/file から先頭の uuid を返す（小文字化）', () => {
    expect(batchPathTeam(`${T}/job1/item1/original.jpg`)).toBe(T)
    expect(batchPathTeam(`${T.toUpperCase()}/job1/item1/mask.png`)).toBe(T)
    expect(batchPathTeam(`/${T}/x`)).toBe(T) // 先頭スラッシュは無視
  })

  it('先頭が uuid 形式でなければ null（拒否）', () => {
    expect(batchPathTeam('not-a-uuid/job/item/a.jpg')).toBeNull()
    expect(batchPathTeam(`${T.slice(0, 20)}/job/item/a.jpg`)).toBeNull()
    expect(batchPathTeam('')).toBeNull()
    expect(batchPathTeam(null)).toBeNull()
    expect(batchPathTeam(123)).toBeNull()
  })

  it('パス中間に他チームの uuid があっても先頭だけを見る', () => {
    const other = '99999999-8888-4777-8666-555555555555'
    expect(batchPathTeam(`${T}/${other}/item/a.jpg`)).toBe(T)
  })
})

import { allowBatchUrl, parseStorageUrl } from './_signMediaLogic'

describe('batch バケットの署名判定（撮影後工程の成果物）', () => {
  const T = '11111111-2222-4333-8444-555555555555'
  const O = '99999999-8888-4777-8666-555555555555'
  const url = (path: string) => `https://x.supabase.co/storage/v1/object/public/batch/${path}`

  it('parseStorageUrl は batch バケットも解釈する（他の未知バケットは null）', () => {
    expect(parseStorageUrl(url(`${T}/interactive/n1/abc.png`))).toEqual({ bucket: 'batch', path: `${T}/interactive/n1/abc.png` })
    expect(parseStorageUrl('https://x.supabase.co/storage/v1/object/public/other/a.png')).toBeNull()
  })

  it('canvas からの署名: 自チームのパスだけ許可、他チーム・未所属は拒否。他バケットは素通し', () => {
    expect(allowBatchUrl(url(`${T}/interactive/n1/abc.png`), T)).toBe(true)
    expect(allowBatchUrl(url(`${O}/interactive/n1/abc.png`), T)).toBe(false)
    expect(allowBatchUrl(url(`${T}/interactive/n1/abc.png`), null)).toBe(false)
    expect(allowBatchUrl('https://x.supabase.co/storage/v1/object/public/generated-images/u/a.png', null)).toBe(true)
  })
})
