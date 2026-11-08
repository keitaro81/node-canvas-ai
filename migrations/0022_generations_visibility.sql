-- 0022: 生成物（generations）のチーム共有（2026-11-08 メモ 75）。
-- アップロード素材（library_items・0020）と同じく個人が基本で、visibility = 'team' にすると同じチーム（支店）のメンバーも
-- ライブラリで見られ、「画像を追加」で選べる。ワークフロー単位の共有（0009: 共有 WF の生成物は閲覧可）はそのまま（OR で合成）。
-- 前提: 0001（generations.team_id・is_team_member）・0020 適用済み。staging → 本番の順に SQL Editor で適用
-- （drop policy if exists で「破壊的操作」の警告が出るが安全）。

alter table public.generations add column if not exists visibility text not null default 'private';
alter table public.generations drop constraint if exists generations_visibility_check;
alter table public.generations add constraint generations_visibility_check check (visibility in ('private', 'team'));
create index if not exists generations_team_shared_idx on public.generations (team_id, created_at desc) where visibility = 'team';

-- 古い行の team_id を、作った人の今のチームで埋める（共有の判定に使う。1 人 1 チーム）
update public.generations g
   set team_id = tm.team_id
  from public.team_members tm
 where tm.user_id = g.user_id and g.team_id is null;

-- 閲覧: チーム共有された生成物は同じチームのメンバーも見られる
drop policy if exists "Users can view team-shared generations" on public.generations;
create policy "Users can view team-shared generations" on public.generations
  for select to authenticated
  using (visibility = 'team' and team_id is not null and public.is_team_member(team_id));

-- 更新: 共有の切り替え・ピン留めは持ち主だけ（既存の「WF の所有者」判定に user_id の判定を足す。他人の共有行は更新できない）
drop policy if exists "Users can update own generations by user_id" on public.generations;
create policy "Users can update own generations by user_id" on public.generations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 確認:
-- select column_name from information_schema.columns where table_name = 'generations' and column_name = 'visibility';  -- 1 行
-- select policyname from pg_policies where tablename = 'generations';  -- "Users can view team-shared generations" と "Users can update own generations by user_id" が並ぶ
