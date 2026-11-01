import { describe, it, expect } from 'vitest'
import { buildTryOnInput, normalizeTryOnParams, tryOnPrompt, tryOnPromptFromNote } from './prompt'

describe('試着プロンプト', () => {
  it('服だけを着せ、2 枚目の人物・ポーズ・小物は出さず、1 枚目は保つ、と明記する', () => {
    const p = tryOnPrompt('the knit cardigan')
    expect(p).toContain('Put ONLY the knit cardigan from the second image')
    expect(p).toContain('must NOT appear')
    expect(p).toContain('Keep the first image exactly as it is')
  })
  it('説明が無ければ汎用の言い方、補足は末尾に足す', () => {
    expect(tryOnPrompt('')).toContain('Put ONLY the main garment that is the product from the second image')
    expect(tryOnPrompt('', 'Zip it up.')).toMatch(/fashion photo\. Zip it up\.$/)
  })
  it('欄の日本語は英訳表で差し替え、無ければそのまま', () => {
    expect(tryOnPromptFromNote('ニットカーディガン', { 'ニットカーディガン': 'A knit cardigan.' })).toMatch(/A knit cardigan\.$/)
    expect(tryOnPromptFromNote('  ')).toBe(tryOnPrompt(''))
    expect(tryOnPromptFromNote('Leather jacket, zipped open.')).toMatch(/zipped open\.$/)
  })
  it('設定の正規化と fal 入力', () => {
    expect(normalizeTryOnParams(undefined)).toEqual({ resolution: '2K', note: '' })
    expect(normalizeTryOnParams({ resolution: '4K', note: 5 })).toEqual({ resolution: '2K', note: '' })
    expect(normalizeTryOnParams({ resolution: '1K', note: 'x' })).toEqual({ resolution: '1K', note: 'x' })
    expect(buildTryOnInput('p', { resolution: '1K', note: '' })).toEqual({ prompt: 'p', resolution: '1K', aspect_ratio: 'auto' })
  })
})
