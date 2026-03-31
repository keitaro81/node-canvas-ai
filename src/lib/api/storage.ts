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
