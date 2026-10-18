// ライブラリ（2026-10-18）: アップロードした画像・動画を登録し、どのプロジェクトからも使えるようにする。
// 個人のものが基本で、visibility = 'team' にするとチームのメンバーも使える。保持はピン留めしていなければ最終利用から 30 日（サーバーの cron が削除）。
// 生成した画像・動画は generations のまま（ライブラリ画面と選択ダイアログで一緒に並べる）。
import { supabase } from '../supabase'
import { readImageSize } from '../batch/upload'
import { resolveTeamId } from '../cutout/store'
import { signMediaRequest } from './storage'

// library_items / library_touch / generations.pinned は生成済みの Database 型に無いので、batchJobs.ts と同じく型を外したクライアントを使う
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any

export type LibraryMedia = 'image' | 'video'
export type LibraryVisibility = 'private' | 'team'
export interface LibraryItem {
  id: string
  user_id: string
  team_id: string
  visibility: LibraryVisibility
  media: LibraryMedia
  bucket: string
  path: string
  name: string | null
  mime: string | null
  bytes: number | null
  width: number | null
  height: number | null
  source: string | null
  pinned: boolean
  last_used_at: string
  created_at: string
}
export const LIBRARY_COLUMNS = 'id, user_id, team_id, visibility, media, bucket, path, name, mime, bytes, width, height, source, pinned, last_used_at, created_at'
export const LIBRARY_RETENTION_DAYS = 30
const BUCKET_OF: Record<LibraryMedia, string> = { image: 'generated-images', video: 'generated-videos' }

/** 保存形式の URL（/object/public/<bucket>/<path>）。表示・生成時はこれをサーバーで署名する（useSignedMedia / signMediaRequest の urls モード） */
export function libraryCanonicalUrl(item: Pick<LibraryItem, 'bucket' | 'path'>): string {
  return supabase.storage.from(item.bucket).getPublicUrl(item.path).data.publicUrl
}

/** 残り日数（ピン留めは null = 期限なし）。最終利用から 30 日 */
export function libraryDaysLeft(item: Pick<LibraryItem, 'pinned' | 'last_used_at'>): number | null {
  if (item.pinned) return null
  const expiry = new Date(item.last_used_at).getTime() + LIBRARY_RETENTION_DAYS * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)))
}

export async function listLibraryItems(opts: { media?: LibraryMedia; scope?: 'all' | 'mine' | 'team'; limit?: number } = {}): Promise<LibraryItem[]> {
  const { data: { user } } = await supabase.auth.getUser()
  let q = sb.from('library_items').select(LIBRARY_COLUMNS).order('created_at', { ascending: false }).limit(opts.limit ?? 500)
  if (opts.media) q = q.eq('media', opts.media)
  if (opts.scope === 'mine' && user) q = q.eq('user_id', user.id)
  if (opts.scope === 'team' && user) q = q.neq('user_id', user.id)   // RLS で見えるのは自分 + チーム共有なので、自分以外 = チーム共有
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as LibraryItem[]
}

const extOf = (file: Blob, fallback: string) => {
  const name = (file as File).name ?? ''
  const ext = (name.split('.').pop() || '').toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback
}

/** ファイルを自前バケットへ上げてライブラリに登録する。画像は generated-images、動画は generated-videos の library/<user>/ 配下 */
export async function uploadToLibrary(file: Blob, opts: { media: LibraryMedia; source: string; name?: string; visibility?: LibraryVisibility }): Promise<LibraryItem> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('ログインが必要です')
  const teamId = await resolveTeamId()
  const id = crypto.randomUUID()
  const ext = extOf(file, opts.media === 'video' ? 'mp4' : 'png')
  const bucket = BUCKET_OF[opts.media]
  const path = `library/${user.id}/${id}.${ext}`
  const contentType = file.type || (opts.media === 'video' ? 'video/mp4' : 'image/png')
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { contentType, upsert: false })
  if (upErr) throw new Error(upErr.message)
  const size = opts.media === 'image' ? await readImageSize(file) : null
  const row = {
    id, user_id: user.id, team_id: teamId, visibility: opts.visibility ?? 'private', media: opts.media, bucket, path,
    name: opts.name ?? (file as File).name ?? null, mime: contentType, bytes: file.size, width: size?.width ?? null, height: size?.height ?? null, source: opts.source,
  }
  const { data, error } = await sb.from('library_items').insert(row).select(LIBRARY_COLUMNS).single()
  if (error) {
    await supabase.storage.from(bucket).remove([path]).catch(() => {})
    throw new Error(error.message)
  }
  return data as LibraryItem
}

/** 最終利用を今にする（入力に選んだ・生成に使った・ダウンロードした）。失敗しても処理は止めない */
export async function touchLibraryItems(ids: string[]): Promise<void> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return
  try { await sb.rpc('library_touch', { p_ids: uniq }) } catch { /* 記録は最善努力 */ }
}

export async function updateLibraryItem(id: string, patch: Partial<Pick<LibraryItem, 'visibility' | 'pinned' | 'name'>>): Promise<LibraryItem> {
  const { data, error } = await sb.from('library_items').update(patch).eq('id', id).select(LIBRARY_COLUMNS).single()
  if (error) throw new Error(error.message)
  return data as LibraryItem
}

export async function deleteLibraryItem(item: Pick<LibraryItem, 'id' | 'bucket' | 'path'>): Promise<void> {
  const { error } = await sb.from('library_items').delete().eq('id', item.id)
  if (error) throw new Error(error.message)
  await supabase.storage.from(item.bucket).remove([item.path]).catch(() => {})
}

/** 表示用の署名 URL（id → url）。見えない素材は省かれる */
export async function signLibraryItems(items: Array<Pick<LibraryItem, 'id' | 'bucket' | 'path'>>): Promise<Record<string, string>> {
  if (!items.length) return {}
  const canon = items.map((it) => [it.id, libraryCanonicalUrl(it)] as const)
  const map = await signMediaRequest({ urls: canon.map(([, u]) => u) })
  const out: Record<string, string> = {}
  for (const [id, u] of canon) if (map[u]) out[id] = map[u]
  return out
}

/** 生成物のピン留め（保持期限から除外） */
export async function setGenerationPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await sb.from('generations').update({ pinned }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** 1 件の保存形式 URL を署名する（ライブラリの素材・生成物のどちらでも） */
export async function signLibraryUrl(url: string): Promise<string> {
  const map = await signMediaRequest({ urls: [url] })
  return map[url] ?? url
}

/** ノード / Capsule 用: ライブラリに登録し、保存形式の URL と表示・生成用の署名 URL を返す */
export async function uploadToLibraryForNode(file: Blob, media: LibraryMedia, source: string): Promise<{ item: LibraryItem; url: string; signedUrl: string }> {
  const item = await uploadToLibrary(file, { media, source })
  const url = libraryCanonicalUrl(item)
  const signedUrl = await signLibraryUrl(url)
  return { item, url, signedUrl }
}

/** 選んだ素材をファイルとして取り出す（App / 一括処理の入力はこれまでどおり batch バケットへ上げ直す。最終利用も記録） */
export async function pickedToFiles(items: Array<{ url: string; name?: string | null; libraryItemId?: string; media: LibraryMedia; file?: File }>): Promise<File[]> {
  const out: File[] = []
  for (const it of items) {
    if (it.file) { out.push(it.file); continue }   // ダイアログで今アップロードしたものは手元の File をそのまま使う
    const signed = await signLibraryUrl(it.url)
    const res = await fetch(signed)
    if (!res.ok) throw new Error(`素材を取得できません (${res.status})`)
    const blob = await res.blob()
    const type = blob.type || (it.media === 'video' ? 'video/mp4' : 'image/jpeg')
    const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || (it.media === 'video' ? 'mp4' : 'jpg')
    const base = (it.name && /\.[a-z0-9]{2,5}$/i.test(it.name)) ? it.name : `${it.name ?? 'library'}.${ext}`
    out.push(new File([blob], base, { type }))
  }
  return out
}
