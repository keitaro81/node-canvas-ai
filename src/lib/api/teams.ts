import { supabase } from '../supabase'

export interface TeamContext {
  teamId: string
  quotaImageMonthly: number
  quotaVideoMonthly: number
  usedImage: number
  usedVideo: number
}

/** クォータの月次キー 'YYYY-MM'（JST基準。fal proxy の currentPeriodJst と一致させること）。 */
export function currentPeriodJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 7)
}

/**
 * ログインユーザーの所属チームと、当月のチーム合計消費を取得する。
 * 未所属（運営未登録）の場合は null。
 * RLS により、自分の所属チームの teams / usage_counters のみ読める。
 */
export async function getMyTeamContext(): Promise<TeamContext | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member } = await (supabase.from('team_members') as any)
    .select('team_id')
    .limit(1)
    .maybeSingle()
  if (!member?.team_id) return null
  const teamId = member.team_id as string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: team } = await (supabase.from('teams') as any)
    .select('quota_image_monthly, quota_video_monthly')
    .eq('id', teamId)
    .maybeSingle()

  const period = currentPeriodJst()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase.from('usage_counters') as any)
    .select('kind, count')
    .eq('team_id', teamId)
    .eq('period', period)

  let usedImage = 0
  let usedVideo = 0
  for (const r of (rows ?? []) as { kind: string; count: number }[]) {
    if (r.kind === 'image') usedImage += r.count ?? 0
    else if (r.kind === 'video') usedVideo += r.count ?? 0
  }

  return {
    teamId,
    quotaImageMonthly: typeof team?.quota_image_monthly === 'number' ? team.quota_image_monthly : 100,
    quotaVideoMonthly: typeof team?.quota_video_monthly === 'number' ? team.quota_video_monthly : 7,
    usedImage,
    usedVideo,
  }
}
