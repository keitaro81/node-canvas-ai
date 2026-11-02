// fal の失敗の理由を、使う人に分かる文にする（2026-11-02 メモ 57）。
// 422 は「入力を受け付けられない」で、ポリシー違反（content_policy_violation）のほか、値の形の誤りなども同じ番号で返る。
// fal の client は ApiError / ValidationError に status と body（detail = [{ loc, msg, type }] か文字列）を持たせるので、それで分ける
export type FalErrorKind = 'policy' | 'input' | 'other'
export interface FalErrorInfo { kind: FalErrorKind; message: string; raw: string }

/** detail の loc（["body", "video_urls", 0] など）→ どの入力か */
function whereOf(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null
  const field = loc[1]
  const index = typeof loc[2] === 'number' ? loc[2] + 1 : null
  if (field === 'video_urls' || field === 'video_url' || field === 'reference_video_urls') return index ? `参照動画 ${index}` : '参照動画'
  if (field === 'image_urls' || field === 'reference_image_urls') return index ? `参照画像 ${index}` : '参照画像'
  if (field === 'image_url' || field === 'start_image_url') return '開始フレームの画像'
  if (field === 'end_image_url' || field === 'tail_image_url') return '終了フレームの画像'
  if (field === 'elements') return '参照一式'
  if (field === 'prompt') return 'プロンプト'
  return typeof field === 'string' ? field : null
}

export function falErrorInfo(error: unknown): FalErrorInfo {
  const e = (error ?? {}) as { status?: number; body?: { detail?: unknown }; message?: string }
  const raw = typeof e.message === 'string' && e.message ? e.message : String(error)
  const d = e.body?.detail
  const first = Array.isArray(d) ? (d[0] as Record<string, unknown> | undefined) : typeof d === 'string' ? { msg: d } : undefined
  if (e.status === 422 && first) {
    const where = whereOf(first.loc)
    const msg = typeof first.msg === 'string' ? first.msg : ''
    const policy = first.type === 'content_policy_violation' || /content (checker|policy)/i.test(msg)
    if (policy && /identifiable real person/i.test(msg)) {
      return { kind: 'policy', raw: msg, message: `${where ?? '入力'}に実在の人物が写っているため、このモデルでは使えません（提供元の制限）。人物を使うときは Kling のモデルにするか、人物の写っていない素材にしてください` }
    }
    if (policy) return { kind: 'policy', raw: msg, message: `${where ? `${where}の内容` : '入力内容'}がモデルのポリシーに違反しているため生成できませんでした` }
    return { kind: 'input', raw: msg, message: `入力を受け付けられませんでした${where ? `（${where}）` : ''}: ${msg || '値の形が合っていません'}` }
  }
  if (e.status === 422) return { kind: 'policy', raw, message: '入力内容がモデルのポリシーに違反しているため生成できませんでした' }   // 理由が読めない 422 は従来どおり
  return { kind: 'other', raw, message: raw || '生成に失敗しました' }
}
