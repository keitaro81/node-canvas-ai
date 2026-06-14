import { supabase } from '../supabase'

const IMAGE_BUCKET = 'generated-images'
const VIDEO_BUCKET = 'generated-videos'

export async function uploadGeneratedImage(file: File, path: string): Promise<string> {
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

export function getPublicUrl(path: string): string {
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * 参照画像・マスク等のクライアントアップロードを自前 generated-images バケットに保存し、永続な公開URLを返す（16c）。
 * 旧: fal.storage.upload（外部）。孤児になったファイルは週次の孤児GCが回収する。
 * 要: storage の image INSERT ポリシー（migration 0007）。
 */
export async function uploadImageFile(file: File, prefix: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png'
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
  await uploadGeneratedImage(file, path)
  return getPublicUrl(path)
}

export async function deleteImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([path])
  if (error) throw error
}

/**
 * fal.aiの一時URLからSupabase Storageに保存し、公開URLを返す。
 * - ローカル開発（VITE_FAL_KEY あり）: Vite Dev Server ミドルウェア経由（サーバーサイド fetch + service role key）
 * - 本番: Edge Function 経由（service role key でアップロード）
 */
export async function uploadImageFromUrl(sourceUrl: string, nodeId: string): Promise<string> {
  // ローカル開発環境: Vite Dev Server ミドルウェア /dev-proxy/save-image 経由
  // （CORS 問題を回避し、service role key で RLS 制約も突破する）
  if (import.meta.env.VITE_FAL_KEY) {
    const res = await fetch('/dev-proxy/save-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl, nodeId }),
    })
    if (!res.ok) {
      const err = await res.json() as { error?: string }
      throw new Error(err.error ?? 'Dev proxy save failed')
    }
    const data = await res.json() as { url: string }
    return data.url
  }

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not authenticated')

  const res = await fetch('/api/storage/save-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sourceUrl, nodeId }),
  })

  if (!res.ok) {
    const err = await res.json() as { error?: string }
    throw new Error(err.error ?? 'Image upload failed')
  }

  const data = await res.json() as { url: string }
  return data.url
}

/**
 * ローカルの動画Fileオブジェクトを直接Supabase Storageに保存し、公開URLを返す。
 */
export async function uploadVideoFile(file: File, nodeId: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'mp4'
  const path = `${nodeId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .upload(path, file, { contentType: file.type || 'video/mp4', upsert: false })
  if (error) throw error

  const { data } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * fal.aiの一時URLから動画をfetchしてSupabase Storageに保存し、公開URLを返す。
 */
export async function uploadVideoFromUrl(sourceUrl: string, nodeId: string): Promise<string> {
  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`)

  const rawContentType = response.headers.get('content-type') ?? 'video/mp4'
  const isWebm = rawContentType.includes('webm')
  const contentType = isWebm ? 'video/webm' : 'video/mp4'
  const ext = isWebm ? 'webm' : 'mp4'
  const path = `${nodeId}/${Date.now()}.${ext}`

  const blob = await response.blob()

  const { error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .upload(path, blob, { contentType, upsert: false })
  if (error) throw error

  const { data } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
