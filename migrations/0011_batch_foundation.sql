-- 0011: 撮影後工程（バッチ）基盤 — ワークスペース列追加・batch_* テーブル・集約RPC・batch バケット・Realtime
--
-- 設計: docs/specs（撮影後工程 仕様書 v4）§4-3 / 4-4 / 8。ワークスペース = 既存 teams を流用（1ユーザー1チーム維持）。
-- 前提: 0001〜0010 適用済み（teams / team_members / is_team_member()）。
-- 冪等: if not exists / drop policy if exists / create or replace。非破壊（既存列は変更しない）。
-- ロールアウト: staging → 本番 の順に SQL Editor で実行。

begin;

-- ───────────────────────────────────────────────
-- (1) ワークスペース列（teams を流用）
-- ───────────────────────────────────────────────
alter table public.teams add column if not exists daily_item_limit int not null default 300;      -- 1日の上限枚数
alter table public.teams add column if not exists show_cost boolean not null default false;       -- 原価を利用者に見せるか
alter table public.team_members add column if not exists display_name text;                      -- 投入者の表示名（無ければ email）

-- ───────────────────────────────────────────────
-- (2) batch_jobs: ジョブ
-- ───────────────────────────────────────────────
create table if not exists public.batch_jobs (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams(id) on delete cascade,
  created_by         uuid references auth.users(id) on delete set null,
  name               text not null,
  workflow_snapshot  jsonb not null,                       -- 投入時点のグラフ＋全パラメータの写し
  status             text not null default 'uploading'
                     check (status in ('uploading','submitted','processing','completed','partial_failed','cancelled')),
  item_count         int not null default 0,
  task_count         int not null default 0,
  completed_tasks    int not null default 0,
  failed_tasks       int not null default 0,
  estimated_cost_usd numeric(10,4) not null default 0,
  actual_cost_usd    numeric(10,4) not null default 0,
  webhook_secret     text not null unique default encode(gen_random_bytes(24), 'hex'),  -- Webhook 宛先に含め受信時に照合
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists batch_jobs_team_created_idx on public.batch_jobs(team_id, created_at desc);
create index if not exists batch_jobs_team_status_idx  on public.batch_jobs(team_id, status);

-- ───────────────────────────────────────────────
-- (3) batch_items: 画像1枚
-- ───────────────────────────────────────────────
create table if not exists public.batch_items (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.batch_jobs(id) on delete cascade,
  team_id           uuid not null references public.teams(id) on delete cascade,
  sort_order        int not null default 0,
  original_filename text not null,
  sku               text not null,
  source_path       text,                                  -- batch バケット内パス（<team>/<job>/<item>/original.<ext>）
  width             int,
  height            int,
  status            text not null default 'pending' check (status in ('pending','processing','ready','failed')),
  review            text not null default 'unreviewed' check (review in ('unreviewed','ok','ng')),
  reviewed_by       uuid references auth.users(id) on delete set null,
  warnings          jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists batch_items_job_order_idx    on public.batch_items(job_id, sort_order);
create index if not exists batch_items_team_sku_idx     on public.batch_items(team_id, sku);         -- SKU 検索
create index if not exists batch_items_team_created_idx on public.batch_items(team_id, created_at);  -- 日次上限の集計

-- ───────────────────────────────────────────────
-- (4) batch_tasks: AI処理1件 = fal.ai リクエスト1件
-- ───────────────────────────────────────────────
create table if not exists public.batch_tasks (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.batch_jobs(id) on delete cascade,
  item_id        uuid references public.batch_items(id) on delete cascade,  -- 実行スコープ「ジョブごと」は null
  team_id        uuid not null references public.teams(id) on delete cascade,
  node_id        text not null,
  endpoint       text not null,
  input          jsonb not null default '{}'::jsonb,
  fal_request_id text unique,                              -- 冪等性の鍵
  status         text not null default 'pending' check (status in ('pending','submitted','completed','failed','cancelled')),
  attempts       int not null default 0,
  error          text,
  result_path    text,
  result_meta    jsonb,
  cost_usd       numeric(10,4) not null default 0,
  submitted_at   timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists batch_tasks_job_idx              on public.batch_tasks(job_id);
create index if not exists batch_tasks_item_idx             on public.batch_tasks(item_id);
create index if not exists batch_tasks_status_submitted_idx on public.batch_tasks(status, submitted_at);  -- 照合(10分超の投入済み)

-- ───────────────────────────────────────────────
-- (5) batch_outputs: レイアウト後の出力（将来のサーバー側レイアウトの受け皿）
-- ───────────────────────────────────────────────
create table if not exists public.batch_outputs (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.batch_items(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  variant     text not null,
  layout_hash text not null,                                -- パラメータ＋マスクから決まる識別値
  output_path text not null,
  executor    text not null default 'browser' check (executor in ('browser','server')),
  created_at  timestamptz not null default now(),
  unique (item_id, variant, layout_hash)
);

-- ───────────────────────────────────────────────
-- (6) RLS: SELECT はワークスペース所属。書込はクライアント不可（service role と下記 RPC のみ）
-- ───────────────────────────────────────────────
alter table public.batch_jobs    enable row level security;
alter table public.batch_items   enable row level security;
alter table public.batch_tasks   enable row level security;
alter table public.batch_outputs enable row level security;

drop policy if exists batch_jobs_member_select    on public.batch_jobs;
drop policy if exists batch_items_member_select   on public.batch_items;
drop policy if exists batch_tasks_member_select   on public.batch_tasks;
drop policy if exists batch_outputs_member_select on public.batch_outputs;
create policy batch_jobs_member_select    on public.batch_jobs    for select to authenticated using (public.is_team_member(team_id));
create policy batch_items_member_select   on public.batch_items   for select to authenticated using (public.is_team_member(team_id));
create policy batch_tasks_member_select   on public.batch_tasks   for select to authenticated using (public.is_team_member(team_id));
create policy batch_outputs_member_select on public.batch_outputs for select to authenticated using (public.is_team_member(team_id));

-- ───────────────────────────────────────────────
-- (7) RPC: タスク完了の反映を1か所に集約（Webhook と照合の両方がこれだけを通る）
--   ①投入済みの場合に限り完了/失敗へ（それ以外は何もしない＝冪等）
--   ②ジョブの完了/失敗数・実績コスト・更新日時
--   ③アイテムの準備完了/失敗判定（自分のタスク＋ジョブごとタスクが全終了）
--   ④全タスク終了ならジョブを完了/一部失敗
--   実際に状態が変わったかを返す。service role のみ実行可。
-- ───────────────────────────────────────────────
create or replace function public.apply_batch_task_result(
  p_task_id     uuid,
  p_outcome     text,                 -- 'completed' | 'failed'
  p_result_path text    default null,
  p_result_meta jsonb   default null,
  p_cost_usd    numeric default 0,
  p_error       text    default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_job_id       uuid;
  v_item_id      uuid;
  v_item_pending int;
  v_item_failed  int;
  v_job_pending  int;
  v_job_failed   int;
begin
  if p_outcome not in ('completed','failed') then
    raise exception 'invalid outcome: %', p_outcome;
  end if;

  -- ① 投入済み → 完了/失敗（それ以外の状態なら false を返して終了）
  update public.batch_tasks
     set status       = p_outcome,
         result_path  = coalesce(p_result_path, result_path),
         result_meta  = coalesce(p_result_meta, result_meta),
         cost_usd     = case when p_outcome = 'completed' then coalesce(p_cost_usd, 0) else cost_usd end,
         error        = case when p_outcome = 'failed' then p_error else error end,
         completed_at = now()
   where id = p_task_id and status = 'submitted'
   returning job_id, item_id into v_job_id, v_item_id;
  if not found then
    return false;
  end if;

  -- ② ジョブ件数・実績コスト
  update public.batch_jobs
     set completed_tasks = completed_tasks + case when p_outcome = 'completed' then 1 else 0 end,
         failed_tasks    = failed_tasks    + case when p_outcome = 'failed'    then 1 else 0 end,
         actual_cost_usd = actual_cost_usd + case when p_outcome = 'completed' then coalesce(p_cost_usd, 0) else 0 end,
         status          = case when status = 'submitted' then 'processing' else status end,
         updated_at      = now()
   where id = v_job_id;

  -- ③ アイテムの準備完了/失敗
  if v_item_id is not null then
    select count(*) filter (where status in ('pending','submitted')),
           count(*) filter (where status = 'failed')
      into v_item_pending, v_item_failed
      from public.batch_tasks
     where job_id = v_job_id and (item_id = v_item_id or item_id is null);
    if v_item_pending = 0 then
      update public.batch_items
         set status = case when v_item_failed > 0 then 'failed' else 'ready' end, updated_at = now()
       where id = v_item_id and status in ('pending','processing');
    end if;
  else
    -- ジョブごとタスクの終了は全アイテムの判定に影響するため再評価
    update public.batch_items i
       set status = case when exists (
                      select 1 from public.batch_tasks t
                       where t.job_id = v_job_id and (t.item_id = i.id or t.item_id is null) and t.status = 'failed')
                    then 'failed' else 'ready' end,
           updated_at = now()
     where i.job_id = v_job_id
       and i.status in ('pending','processing')
       and not exists (
         select 1 from public.batch_tasks t
          where t.job_id = v_job_id and (t.item_id = i.id or t.item_id is null) and t.status in ('pending','submitted'));
  end if;

  -- ④ 全タスク終了ならジョブ完了/一部失敗
  select count(*) filter (where status in ('pending','submitted')),
         count(*) filter (where status = 'failed')
    into v_job_pending, v_job_failed
    from public.batch_tasks where job_id = v_job_id;
  if v_job_pending = 0 then
    update public.batch_jobs
       set status = case when v_job_failed > 0 then 'partial_failed' else 'completed' end, updated_at = now()
     where id = v_job_id and status in ('submitted','processing');
  end if;

  return true;
end $$;
revoke all on function public.apply_batch_task_result(uuid, text, text, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_batch_task_result(uuid, text, text, jsonb, numeric, text) to service_role;

-- ───────────────────────────────────────────────
-- (8) クライアントから呼べる書込は RPC 2本のみ（列を絞る・所属チェック付き）
-- ───────────────────────────────────────────────
create or replace function public.review_batch_item(p_item_id uuid, p_review text)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  if p_review not in ('unreviewed','ok','ng') then raise exception 'invalid review: %', p_review; end if;
  select team_id into v_team from public.batch_items where id = p_item_id;
  if v_team is null or not public.is_team_member(v_team) then raise exception 'forbidden'; end if;
  update public.batch_items set review = p_review, reviewed_by = auth.uid(), updated_at = now() where id = p_item_id;
end $$;
grant execute on function public.review_batch_item(uuid, text) to authenticated;

create or replace function public.record_batch_output(p_item_id uuid, p_variant text, p_layout_hash text, p_output_path text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_id uuid;
begin
  select team_id into v_team from public.batch_items where id = p_item_id;
  if v_team is null or not public.is_team_member(v_team) then raise exception 'forbidden'; end if;
  insert into public.batch_outputs (item_id, team_id, variant, layout_hash, output_path, executor)
  values (p_item_id, v_team, p_variant, p_layout_hash, p_output_path, 'browser')
  on conflict (item_id, variant, layout_hash) do update set output_path = excluded.output_path
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.record_batch_output(uuid, text, text, text) to authenticated;

-- ───────────────────────────────────────────────
-- (9) Storage: 私有バケット batch。パス先頭 <team_id> への所属で読取/アップロード可。削除は service role のみ
-- ───────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('batch', 'batch', false) on conflict (id) do nothing;

-- パス先頭セグメントを安全に uuid 化（uuid 形式でなければ null＝拒否）
create or replace function public.batch_path_team(p_name text)
returns uuid language sql immutable as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (storage.foldername(p_name))[1]::uuid
    else null
  end
$$;

drop policy if exists "batch members read"   on storage.objects;
drop policy if exists "batch members upload" on storage.objects;
create policy "batch members read" on storage.objects for select to authenticated
  using (bucket_id = 'batch' and public.batch_path_team(name) is not null and public.is_team_member(public.batch_path_team(name)));
create policy "batch members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'batch' and public.batch_path_team(name) is not null and public.is_team_member(public.batch_path_team(name)));

-- ───────────────────────────────────────────────
-- (10) Realtime: ジョブ/アイテム/タスクの変更を購読可能に（RLS が購読にも効く）
-- ───────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.batch_jobs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.batch_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.batch_tasks;
exception when duplicate_object then null; end $$;

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================
-- select column_name from information_schema.columns where table_name='teams' and column_name in ('daily_item_limit','show_cost');       -- 2行
-- select column_name from information_schema.columns where table_name='team_members' and column_name='display_name';                     -- 1行
-- select table_name from information_schema.tables where table_schema='public' and table_name like 'batch_%' order by 1;              -- 4行
-- select proname from pg_proc where proname in ('apply_batch_task_result','review_batch_item','record_batch_output','batch_path_team'); -- 4行
-- select id, public from storage.buckets where id='batch';                                                                             -- public=false
-- select policyname from pg_policies where schemaname='storage' and policyname like 'batch members%';                                -- 2行
-- select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename like 'batch_%';                          -- 3行
