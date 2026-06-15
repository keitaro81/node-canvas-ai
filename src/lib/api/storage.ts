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

// ===== 署名URL層（バケット非公開化 L1） =====
// DB保存形は /object/public/<bucket>/<path>（canonical）のまま。読込口で署名URLへ変換し、
// 書込口で canonical へ正規化する。fal.media・blob:・data:・外部URL は対象外（素通し）。

export type StorageTier = 'private' | 'public'

// 将来の「明示公開」アセット用バケット（L2）。L1では予約のみ・未使用。
export const PUBLIC_MEDIA_BUCKET = 'public-media'

const PRIVATE_BUCKETS = new Set<string>([IMAGE_BUCKET, VIDEO_BUCKET])

// 署名URLの有効期限（秒）。長め=再署名チャーン最小／流出URLは24hで失効。tunable。
export const SIGNED_URL_TTL = 60 * 60 * 24

/**
 * 保存値から自前バケットの { bucket, path } を抽出する。
 * 公開形式 /object/public/<bucket>/<path> と署名形式 /object/sign/<bucket>/<path>?token=... の両方を認識。
 * fal.media・blob:・data:・外部URL・null は対象外として null を返す。
 */
export function toStoragePath(value: string | null | undefined): { bucket: string; path: string } | null {
  if (!value || typeof value !== 'string') return null
  for (const marker of ['/object/public/', '/object/sign/']) {
    const i = value.indexOf(marker)
    if (i === -1) continue
    let rest = value.slice(i + marker.length)
    const q = rest.indexOf('?')
    if (q !== -1) rest = rest.slice(0, q)
    const slash = rest.indexOf('/')
    if (slash === -1) return null
    const bucket = rest.slice(0, slash)
    if (!PRIVATE_BUCKETS.has(bucket)) return null
    const path = decodeURIComponent(rest.slice(slash + 1))
    return path ? { bucket, path } : null
  }
  return null
}

/**
 * 永続保存用の canonical 参照（/object/public/<bucket>/<path>）へ正規化する。
 * 署名URL・公開URLは canonical へ戻し、それ以外（fal/blob/data/外部/null）は素通し。
 */
export function toCanonicalRef(value: string | null | undefined): string | null | undefined {
  if (!value) return value
  const parsed = toStoragePath(value)
  if (!parsed) return value
  return supabase.storage.from(parsed.bucket).getPublicUrl(parsed.path).data.publicUrl
}

/** 単一の値を署名URL化する（自前バケット以外・失敗時は元値）。onError 再署名で使用。 */
export async function getSignedUrl(value: string | null | undefined): Promise<string | null | undefined> {
  if (!value) return value
  const parsed = toStoragePath(value)
  if (!parsed) return value
  try {
    const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, SIGNED_URL_TTL)
    if (error || !data?.signedUrl) return value
    return data.signedUrl
  } catch {
    return value
  }
}

/**
 * 複数の値を一括署名する。返り値は「元の入力文字列 → 署名URL」の Map。
 * 自前バケットの値のみ署名（バケット単位 createSignedUrls で N+1 回避）。
 * 失敗した値は Map に入れない（呼び出し側が元値を維持）。1件失敗で全体を壊さない。
 */
export async function getSignedUrls(values: Array<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  // bucket -> (path -> 同一パスを指す元の入力値の配列)
  const buckets = new Map<string, Map<string, string[]>>()
  for (const v of values) {
    if (!v || out.has(v)) continue
    const parsed = toStoragePath(v)
    if (!parsed) continue
    let pm = buckets.get(parsed.bucket)
    if (!pm) { pm = new Map(); buckets.set(parsed.bucket, pm) }
    const arr = pm.get(parsed.path)
    if (arr) arr.push(v)
    else pm.set(parsed.path, [v])
  }
  for (const [bucket, pm] of buckets) {
    const paths = [...pm.keys()]
    if (!paths.length) continue
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL)
      if (error || !data) continue
      for (const item of data) {
        if (item.error || !item.signedUrl || !item.path) continue
        const vals = pm.get(item.path)
        if (vals) for (const v of vals) out.set(v, item.signedUrl)
      }
    } catch {
      // この bucket の署名失敗は無視（呼び出し側が元値を維持）
      continue
    }
  }
  return out
}

/**
 * 将来の公開アセット tier（L2）のための予約シグネチャ。L1では未実装。
 * 「公開」操作で private バケットの対象を public-media バケットへコピーし公開URLを返す想定。
 */
export async function publishAsset(_bucket: string, _path: string): Promise<string> {
  throw new Error('publishAsset: not implemented (reserved for L2 public tier)')
}
