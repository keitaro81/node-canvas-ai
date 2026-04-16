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

export async function deleteImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([path])
  if (error) throw error
}

/**
 * fal.aiの一時URLからサーバーサイド経由でSupabase Storageに保存し、公開URLを返す。
 * クライアントから直接 fal.ai URL を fetch すると CORS エラーになるため Edge Function 経由。
 * ローカル開発（VITE_FAL_KEY あり）では Edge Function が動かないためスキップする。
 */
export async function uploadImageFromUrl(sourceUrl: string, nodeId: string): Promise<string> {
  // ローカル開発環境ではスキップして fal.ai URL をそのまま返す
  if (import.meta.env.VITE_FAL_KEY) {
    return sourceUrl
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
