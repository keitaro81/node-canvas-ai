-- 0019: 商品動画の 1 日の上限を画像（枚）とは別にする（2026-10-17・ユーザー決定: 動画は 20 本/日）
--   batch_jobs.kind: 'cutout'（切り抜きなど写真の処理）| 'video'（商品動画）。日次の集計を種類ごとに分ける
--   teams.daily_video_limit: 動画の 1 日の上限（本）。既定 20
--   team_batch_limits(): 枚と本を分けて返す（used_today / daily_limit = 枚、used_videos_today / daily_video_limit = 本）
begin;

alter table public.batch_jobs add column if not exists kind text not null default 'cutout';
alter table public.batch_jobs drop constraint if exists batch_jobs_kind_check;
alter table public.batch_jobs add constraint batch_jobs_kind_check check (kind in ('cutout', 'video'));
create index if not exists batch_jobs_team_kind_created_idx on public.batch_jobs(team_id, kind, created_at);
comment on column public.batch_jobs.kind is '処理の種類: cutout = 写真（枚で数える）/ video = 商品動画（本で数える）';
-- 既存の商品動画ジョブ（写しに Product Video ノードがあるもの）を video に
update public.batch_jobs set kind = 'video' where kind = 'cutout' and workflow_snapshot::text like '%"productVideo"%';

alter table public.teams add column if not exists daily_video_limit int not null default 20;
comment on column public.teams.daily_video_limit is '商品動画の 1 日の上限（本・JST）。画像の daily_item_limit とは別';

create or replace function public.team_batch_limits()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_team uuid; v_used int; v_used_videos int; v_active int; v_limit int; v_video_limit int; v_day_start timestamptz;
begin
  select team_id into v_team from public.team_members where user_id = auth.uid() limit 1;
  if v_team is null then return null; end if;
  select daily_item_limit, daily_video_limit into v_limit, v_video_limit from public.teams where id = v_team;
  v_day_start := ((now() at time zone 'Asia/Tokyo')::date)::timestamp at time zone 'Asia/Tokyo';
  select coalesce(sum(item_count), 0) into v_used from public.batch_jobs where team_id = v_team and status <> 'cancelled' and created_at >= v_day_start and kind <> 'video';
  select coalesce(sum(item_count), 0) into v_used_videos from public.batch_jobs where team_id = v_team and status <> 'cancelled' and created_at >= v_day_start and kind = 'video';
  select count(*) into v_active from public.batch_jobs where team_id = v_team and status in ('uploading','submitted','processing');
  return jsonb_build_object('used_today', v_used, 'active_jobs', v_active, 'daily_limit', coalesce(v_limit, 300), 'used_videos_today', v_used_videos, 'daily_video_limit', coalesce(v_video_limit, 20));
end $$;
revoke all on function public.team_batch_limits() from public, anon;
grant execute on function public.team_batch_limits() to authenticated;

commit;

-- 検証: select kind, count(*) from public.batch_jobs group by kind;  select daily_video_limit from public.teams limit 3;
