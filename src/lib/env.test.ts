import { describe, it, expect } from 'vitest'
import { cleanEnv } from './env'

describe('cleanEnv', () => {
  it('前後の空白と改行を落とす。未設定は空文字', () => {
    expect(cleanEnv('eyJabc\n')).toBe('eyJabc')
    expect(cleanEnv('  https://x.supabase.co \r\n')).toBe('https://x.supabase.co')
    expect(cleanEnv(undefined)).toBe('')
    expect(cleanEnv(null)).toBe('')
  })
})
