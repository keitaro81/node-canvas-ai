-- 0021: ライブラリのモデル（人物）登録（2026-10-24）。役割ごとのカット（ライブラリの素材）をひとまとめにして名前を付け、
-- 商品動画 App の SKU カードへ一度に入れる。素材と同じく個人が基本で visibility = 'team' ならチームのメンバーも使える。
-- モデルが参照する素材は登録時にピン留め（自動削除の対象外）にし、保持の cron もモデルが参照する素材は消さない。
-- 前提: 0020 適用済み。staging → 本番の順に SQL Editor で適用（drop policy if exists で「破壊的操作」の警告が出るが安全）。

create table if not exists public.library_models (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  visibility  text not null default 'private' check (visibility in ('private', 'team')),
  name        text not null,
  note        text,
  cuts        jsonb not null default '{}'::jsonb,   -- { "front": "<library_item_id>", "right": "...", ... } 正面は必須
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists library_models_team_idx on public.library_models (team_id, created_at desc);
create index if not exists library_models_user_idx on public.library_models (user_id, created_at desc);

alter table public.library_models enable row level security;
drop policy if exists library_models_select on public.library_models;
create policy library_models_select on public.library_models for select to authenticated
  using (user_id = auth.uid() or (visibility = 'team' and public.is_team_member(team_id)));
drop policy if exists library_models_insert on public.library_models;
create policy library_models_insert on public.library_models for insert to authenticated
  with check (user_id = auth.uid() and public.is_team_member(team_id));
drop policy if exists library_models_update on public.library_models;
create policy library_models_update on public.library_models for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists library_models_delete on public.library_models;
create policy library_models_delete on public.library_models for delete to authenticated
  using (user_id = auth.uid());

-- 確認:
-- select count(*) from public.library_models;                              -- 0
-- select policyname from pg_policies where tablename = 'library_models';   -- 4 行
