-- 0001: チーム・月次クォータ・使用量カウンタのスキーマ + RLS
--
-- 着手順2（チーム管理 / 月次クォータ再設計 / 履歴削除）の土台。
-- 設計: メモリ project_team_quota_design.md
--   - クォータ単位 = 月次リセット・チーム合計
--   - チーム作成/メンバー登録は運営が手動（service role）
--   - usage_counters は user_id 粒度で記録（将来「ユーザー=店舗」の個人上限に備える保険）
--
-- 冪等: create table if not exists / create or replace / drop policy if exists を使用。
-- 本ファイルはスキーマ定義のみ。既存データの移行は 0002 で行う。
-- 注意: generations の既存 RLS は変更しない（team_id カラムの追加のみ）。

begin;

-- ============================================================
-- 1. teams: チーム本体。月次クォータ上限を保持。
-- ============================================================
create table if not exists public.teams (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  quota_image_monthly  integer not null default 100,
  quota_video_monthly  integer not null default 7,
  created_at           timestamptz not null default now()
);

-- ============================================================
-- 2. team_members: チームとユーザーの紐付け（運営が手動登録）
-- ============================================================
create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id)  on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
-- PK は (team_id, user_id)。ユーザー → 所属チーム逆引き（is_team_member 等）用に user_id 単独索引。
create index if not exists team_members_user_id_idx on public.team_members(user_id);

-- ============================================================
-- 3. usage_counters: 月次クォータ判定の真実のソース。
--    生成リクエストをサーバー（fal proxy）が通すたびに +1（失敗も消費＝合意済み）。
--    user_id 粒度で持つが、今回の判定はチーム合計（team_id+period+kind で SUM）のみ。
-- ============================================================
create table if not exists public.usage_counters (
  team_id uuid    not null references public.teams(id) on delete cascade,
  user_id uuid    not null references auth.users(id)  on delete cascade,
  period  text    not null,                                  -- 'YYYY-MM'（当月キー。リセットはキーが変わるだけ）
  kind    text    not null check (kind in ('image', 'video')),
  count   integer not null default 0,
  primary key (team_id, user_id, period, kind)
);
-- チーム合計の当月集計を高速化（判定の主クエリ: where team_id=? and period=? and kind=?）
create index if not exists usage_counters_team_period_kind_idx
  on public.usage_counters(team_id, period, kind);

-- ============================================================
-- 4. generations.team_id: 履歴の所属・カスケード削除・チーム集計用。
--    既存の RLS / ポリシーは変更しない。
-- ============================================================
alter table public.generations
  add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists generations_team_id_idx on public.generations(team_id);

-- ============================================================
-- 5. RLS ヘルパー: 自分が指定チームのメンバーか判定。
--    security definer + search_path 固定で、team_members の RLS 再帰を回避する。
-- ============================================================
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

-- ============================================================
-- 6. RLS: 読み取りは「自分の所属チーム」のみ。
--    書き込み（チーム管理・クォータ加算）は service role のみ（ポリシーを作らない＝authenticated 不可）。
-- ============================================================
alter table public.teams          enable row level security;
alter table public.team_members   enable row level security;
alter table public.usage_counters enable row level security;

drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated
  using (public.is_team_member(id));

drop policy if exists team_members_select_member on public.team_members;
create policy team_members_select_member on public.team_members
  for select to authenticated
  using (public.is_team_member(team_id));

drop policy if exists usage_counters_select_member on public.usage_counters;
create policy usage_counters_select_member on public.usage_counters
  for select to authenticated
  using (public.is_team_member(team_id));

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name in ('teams','team_members','usage_counters');  -- 3行
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='generations' and column_name='team_id';        -- 1行
-- select polname, relname from pg_policies join pg_class on pg_class.relname = tablename
--   where tablename in ('teams','team_members','usage_counters');                               -- 各1ポリシー
