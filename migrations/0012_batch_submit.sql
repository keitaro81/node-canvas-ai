-- 0012_batch_submit.sql — 撮影後工程 Step 5: バッチ投入・Webhook・照合
-- 適用: Supabase SQL Editor（staging → 本番）。破壊的操作なし（索引追加・列追加・関数の置換のみ）。
begin;

-- ───────────────────────────────────────────────
-- (1) タスクの一意性: 同じ (ジョブ, ノード, アイテム) のタスクは 1 件だけ。
--     ジョブごとタスクは item_id が null なので NULLS NOT DISTINCT で重複を防ぐ（投入の再実行で二重に作らない）。
-- ───────────────────────────────────────────────
create unique index if not exists batch_tasks_job_node_item_uidx
  on public.batch_tasks (job_id, node_id, item_id) nulls not distinct;

-- (2) 照合（投入から一定時間 submitted のまま）とジョブ一覧の走査用
create index if not exists batch_tasks_status_submitted_idx on public.batch_tasks (status, submitted_at);
create index if not exists batch_tasks_job_status_idx on public.batch_tasks (job_id, status);
create index if not exists batch_jobs_team_created_idx on public.batch_jobs (team_id, created_at desc);
create index if not exists batch_items_job_order_idx on public.batch_items (job_id, sort_order);

-- (3) アイテムのコピー元（Batch Input が対話用にアップロード済みのパス）。投入時にジョブ階層へコピーする
alter table public.batch_items add column if not exists interactive_path text;

-- ───────────────────────────────────────────────
-- (4) 集約 RPC の更新: 「投入前（pending）のタスクを失敗にする」遷移を追加。
--     fal への投入自体が規定回数失敗したときも、同じ 1 か所を通して件数・アイテム・ジョブ状態を反映する。
--     完了（completed）は従来どおり submitted からのみ。
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

  -- ① 投入済み → 完了/失敗。失敗は未投入（pending）からも可。それ以外の状態なら false（冪等）
  update public.batch_tasks
     set status       = p_outcome,
         result_path  = coalesce(p_result_path, result_path),
         result_meta  = coalesce(p_result_meta, result_meta),
         cost_usd     = case when p_outcome = 'completed' then coalesce(p_cost_usd, 0) else cost_usd end,
         error        = case when p_outcome = 'failed' then p_error else error end,
         completed_at = now()
   where id = p_task_id
     and (status = 'submitted' or (p_outcome = 'failed' and status = 'pending'))
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

commit;

-- ───────────────────────────────────────────────
-- 検証（1 クエリで 4 行・すべて ok = true になれば適用完了）
-- ───────────────────────────────────────────────
-- select 'uidx' as chk, exists (select 1 from pg_indexes where indexname = 'batch_tasks_job_node_item_uidx') as ok
-- union all select 'interactive_path', exists (select 1 from information_schema.columns where table_name = 'batch_items' and column_name = 'interactive_path')
-- union all select 'submitted_idx', exists (select 1 from pg_indexes where indexname = 'batch_tasks_status_submitted_idx')
-- union all select 'rpc_pending_fail', (select prosrc like '%p_outcome = ''failed'' and status = ''pending''%' from pg_proc where proname = 'apply_batch_task_result');
