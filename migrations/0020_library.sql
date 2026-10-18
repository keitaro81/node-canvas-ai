-- 0020: ライブラリ（2026-10-18）。アップロードした画像・動画を登録し、どのプロジェクトからも使えるようにする。
-- 個人のものが基本で、visibility = 'team' にするとチーム（支店）のメンバーも使える。
-- 保持: ピン留めしていないアップロードは最終利用（last_used_at）から 30 日で自動削除（api/cron/cleanup-library）。
-- 生成物（generations）はこれまでどおり作成から 90 日。pinned を付けると削除しない。
-- 前提: 0001〜0019 適用済み（teams / team_members / is_team_member()）。staging → 本番の順に SQL Editor で適用。

create table if not exists public.library_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,     -- 持ち主
  team_id       uuid not null references public.teams(id) on delete cascade,  -- 登録時の所属チーム（共有先）
  visibility    text not null default 'private' check (visibility in ('private', 'team')),
  media         text not null check (media in ('image', 'video')),
  bucket        text not null,                                                 -- 'generated-images' | 'generated-videos' | 'batch'
  path          text not null,
  name          text,
  mime          text,
  bytes         bigint,
  width         int,
  height        int,
  source        text,                                                          -- 'upload' | 'canvas' | 'capsule' | 'app-cuts' | 'batch-input' | 'backfill'
  pinned        boolean not null default false,                                -- 削除しない（保存）
  last_used_at  timestamptz not null default now(),                            -- 最終利用（入力に選んだ・生成に使った・ダウンロードした）
  created_at    timestamptz not null default now(),
  unique (bucket, path)
);
create index if not exists library_items_team_created_idx on public.library_items (team_id, created_at desc);
create index if not exists library_items_user_created_idx on public.library_items (user_id, created_at desc);
create index if not exists library_items_last_used_idx   on public.library_items (last_used_at) where not pinned;

alter table public.library_items enable row level security;
drop policy if exists library_items_select on public.library_items;
create policy library_items_select on public.library_items for select to authenticated
  using (user_id = auth.uid() or (visibility = 'team' and public.is_team_member(team_id)));
drop policy if exists library_items_insert on public.library_items;
create policy library_items_insert on public.library_items for insert to authenticated
  with check (user_id = auth.uid() and public.is_team_member(team_id));
drop policy if exists library_items_update on public.library_items;
create policy library_items_update on public.library_items for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists library_items_delete on public.library_items;
create policy library_items_delete on public.library_items for delete to authenticated
  using (user_id = auth.uid());

-- 最終利用の記録。チーム共有の素材は持ち主以外も使うので、見える素材なら誰でも触れる（security definer）
create or replace function public.library_touch(p_ids uuid[])
returns void
language sql security definer set search_path = public as $$
  update public.library_items
     set last_used_at = now()
   where id = any(p_ids)
     and (user_id = auth.uid() or (visibility = 'team' and public.is_team_member(team_id)));
$$;
revoke all on function public.library_touch(uuid[]) from public;
grant execute on function public.library_touch(uuid[]) to authenticated;

-- 生成物のピン留め（保持期限から除外。更新は既存の「Users can update own generations」ポリシーで本人のみ）
alter table public.generations add column if not exists pinned boolean not null default false;

-- 確認:
-- select count(*) from public.library_items;                                                        -- 0
-- select policyname from pg_policies where tablename = 'library_items';                             -- 4 行
-- select column_name from information_schema.columns where table_name = 'generations' and column_name = 'pinned';  -- 1 行
