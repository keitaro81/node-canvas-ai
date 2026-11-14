import { describe, it, expect } from 'vitest'
import { RESULT_EXPIRED_MESSAGE, falErrorInfo, recoveryErrorMessage } from './falErrors'

const apiError = (status: number, detail: unknown) => Object.assign(new Error('Unprocessable Entity'), { status, body: { detail } })

describe('fal の失敗の理由（2026-11-02 メモ 57）', () => {
  it('実在の人物の判定は、どの入力かと直し方を出す', () => {
    const r = falErrorInfo(apiError(422, [{ loc: ['body', 'video_urls', 0], msg: 'The content could not be processed because it contained material flagged by a content checker. Cause: the provider detected an identifiable real person.', type: 'content_policy_violation' }]))
    expect(r.kind).toBe('policy')
    expect(r.message).toContain('参照動画 1に実在の人物が写っているため')
    expect(r.message).toContain('Kling')
  })
  it('ほかのポリシー違反と、形の誤り（422 でもポリシーではない）', () => {
    expect(falErrorInfo(apiError(422, [{ loc: ['body', 'prompt'], msg: 'flagged', type: 'content_policy_violation' }])).message).toBe('プロンプトの内容がモデルのポリシーに違反しているため生成できませんでした')
    const bad = falErrorInfo(apiError(422, [{ loc: ['body', 'resolution'], msg: "Input should be '480p' or '720p'", type: 'literal_error' }]))
    expect(bad).toEqual({ kind: 'input', raw: "Input should be '480p' or '720p'", message: "入力を受け付けられませんでした（resolution）: Input should be '480p' or '720p'" })
    expect(falErrorInfo(apiError(422, 'Failed to download the file')).kind).toBe('input')
  })
  it('理由が読めない 422 は従来どおり、それ以外はそのまま', () => {
    expect(falErrorInfo(Object.assign(new Error('x'), { status: 422 })).kind).toBe('policy')
    expect(falErrorInfo(new Error('timeout'))).toEqual({ kind: 'other', raw: 'timeout', message: 'timeout' })
  })
})

describe('再読み込み後の復旧の失敗（2026-11-14 メモ 83: fal 側の結果が消えていたら、作り直しを伝える）', () => {
  it('結果が消えている（404）ときは、期限切れと作り直しを伝える', () => {
    const gone = Object.assign(new Error('Not Found'), { status: 404, body: { detail: 'Request not found' } })
    expect(recoveryErrorMessage(gone)).toBe(RESULT_EXPIRED_MESSAGE)
    expect(RESULT_EXPIRED_MESSAGE).toContain('もう一度生成')
  })
  it('それ以外の失敗は、通常の失敗の文のまま（ポリシー違反・通信の失敗など）', () => {
    expect(recoveryErrorMessage(apiError(422, [{ loc: ['body', 'prompt'], msg: 'bad', type: 'content_policy_violation' }]))).toContain('ポリシー')
    expect(recoveryErrorMessage(new Error('timeout'))).toBe('timeout')
    expect(recoveryErrorMessage(null)).toBeTruthy()
  })
})
