-- 0016: ジョブの見え方をワークフローの共有に従わせる（撮影後工程・ユーザー決定 2026-09-26）
--
-- ルール: ジョブが見えるのは「作成者本人」「チームの owner」「元ワークフローが team/public で共有されているチームメンバー」。
--        非公開ワークフローのジョブは作成者と owner だけに見える（一覧・詳細・アイテム・タスク・出力・ファイル・Realtime すべて）。
--        編集（レイアウト設定の保存）は作成者だけ。確認結果はジョブが見える人なら誰でも。
-- 前提: 0011〜0014 適用済み。冪等・非破壊。ロールアウト: staging → 本番。

begin;

-- ───────────────────────────────────────────────
-- (1) 閲覧判定（RLS と Edge の両方から使う。p_user_id 版は service role がユーザーを指定して呼ぶ）
-- ───────────────────────────────────────────────
create or replace function public.can_view_batch_job_as(p_job_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.batch_jobs j
      join public.team_members me on me.team_id = j.team_id and me.user_id = p_user_id
     where j.id = p_job_id
       and (
         j.created_by = p_user_id
         or me.role = 'owner'
         or exists (select 1 from public.workflows w where w.id = j.workflow_id and w.visibility in ('team', 'public'))
       )
  )
$$;
revoke all on function public.can_view_batch_job_as(uuid, uuid) from public, anon;
grant execute on function public.can_view_batch_job_as(uuid, uuid) to authenticated, service_role;

create or replace function public.can_view_batch_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view_batch_job_as(p_job_id, auth.uid())
$$;
revoke all on function public.can_view_batch_job(uuid) from public, anon;
grant execute on function public.can_view_batch_job(uuid) to authenticated;

-- ───────────────────────────────────────────────
-- (2) SELECT ポリシーの差し替え（書込はこれまでどおり service role と RPC のみ）
-- ───────────────────────────────────────────────
drop policy if exists batch_jobs_member_select    on public.batch_jobs;
drop policy if exists batch_items_member_select   on public.batch_items;
drop policy if exists batch_tasks_member_select   on public.batch_tasks;
drop policy if exists batch_outputs_member_select on public.batch_outputs;
drop policy if exists batch_jobs_visible_select    on public.batch_jobs;
drop policy if exists batch_items_visible_select   on public.batch_items;
drop policy if exists batch_tasks_visible_select   on public.batch_tasks;
drop policy if exists batch_outputs_visible_select on public.batch_outputs;
create policy batch_jobs_visible_select    on public.batch_jobs    for select to authenticated using (public.can_view_batch_job(id));
create policy batch_items_visible_select   on public.batch_items   for select to authenticated using (public.can_view_batch_job(job_id));
create policy batch_tasks_visible_select   on public.batch_tasks   for select to authenticated using (public.can_view_batch_job(job_id));
create policy batch_outputs_visible_select on public.batch_outputs for select to authenticated
  using (exists (select 1 from public.batch_items i where i.id = batch_outputs.item_id and public.can_view_batch_job(i.job_id)));

-- ───────────────────────────────────────────────
-- (3) Storage: <team>/<job>/... はそのジョブが見える人だけ。<team>/interactive/... は従来どおりチーム所属
-- ───────────────────────────────────────────────
create or replace function public.batch_path_job(p_name text)
returns uuid language sql immutable as $$
  select case
    when (storage.foldername(p_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (storage.foldername(p_name))[2]::uuid
    else null
  end
$$;
drop policy if exists "batch members read"   on storage.objects;
drop policy if exists "batch members upload" on storage.objects;
create policy "batch members read" on storage.objects for select to authenticated
  using (bucket_id = 'batch'
         and public.batch_path_team(name) is not null and public.is_team_member(public.batch_path_team(name))
         and (public.batch_path_job(name) is null or public.can_view_batch_job(public.batch_path_job(name))));
create policy "batch members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'batch'
              and public.batch_path_team(name) is not null and public.is_team_member(public.batch_path_team(name))
              and (public.batch_path_job(name) is null or public.can_view_batch_job(public.batch_path_job(name))));

-- ───────────────────────────────────────────────
-- (4) クライアント書込 RPC: 確認結果と出力の記録は「ジョブが見える人」、レイアウト設定の保存は「作成者」だけ
-- ───────────────────────────────────────────────
create or replace function public.review_batch_item(p_item_id uuid, p_review text)
returns void language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  if p_review not in ('unreviewed','ok','ng') then raise exception 'invalid review: %', p_review; end if;
  select job_id into v_job from public.batch_items where id = p_item_id;
  if v_job is null or not public.can_view_batch_job(v_job) then raise exception 'forbidden'; end if;
  update public.batch_items set review = p_review, reviewed_by = auth.uid(), updated_at = now() where id = p_item_id;
end $$;

create or replace function public.record_batch_output(p_item_id uuid, p_variant text, p_layout_hash text, p_output_path text, p_kind text default 'full')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_job uuid; v_id uuid;
begin
  if p_kind not in ('full','thumb') then raise exception 'invalid kind: %', p_kind; end if;
  select team_id, job_id into v_team, v_job from public.batch_items where id = p_item_id;
  if v_job is null or not public.can_view_batch_job(v_job) then raise exception 'forbidden'; end if;
  if position((v_team::text || '/') in p_output_path) <> 1 then raise exception 'invalid path'; end if;
  insert into public.batch_outputs (item_id, team_id, variant, layout_hash, output_path, executor, kind)
  values (p_item_id, v_team, p_variant, p_layout_hash, p_output_path, 'browser', p_kind)
  on conflict (item_id, variant, layout_hash, kind) do update set output_path = excluded.output_path
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_batch_job_layout(p_job_id uuid, p_overrides jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  if p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then raise exception 'invalid overrides'; end if;
  select created_by into v_creator from public.batch_jobs where id = p_job_id;
  if v_creator is null or v_creator <> auth.uid() then raise exception 'forbidden'; end if;
  update public.batch_jobs set layout_overrides = p_overrides, updated_at = now() where id = p_job_id;
end $$;

-- ───────────────────────────────────────────────
-- (5) 本日の利用枚数と進行中ジョブ数（チーム全体・見えないジョブも数える。一覧の上部表示用）
-- ───────────────────────────────────────────────
create or replace function public.team_batch_limits()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_team uuid; v_used int; v_active int; v_limit int; v_day_start timestamptz;
begin
  select team_id into v_team from public.team_members where user_id = auth.uid() limit 1;
  if v_team is null then return null; end if;
  select daily_item_limit into v_limit from public.teams where id = v_team;
  v_day_start := ((now() at time zone 'Asia/Tokyo')::date)::timestamp at time zone 'Asia/Tokyo';
  select coalesce(sum(item_count), 0) into v_used from public.batch_jobs where team_id = v_team and status <> 'cancelled' and created_at >= v_day_start;
  select count(*) into v_active from public.batch_jobs where team_id = v_team and status in ('uploading','submitted','processing');
  return jsonb_build_object('used_today', v_used, 'active_jobs', v_active, 'daily_limit', coalesce(v_limit, 300));
end $$;
revoke all on function public.team_batch_limits() from public, anon;
grant execute on function public.team_batch_limits() to authenticated;

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================
-- select policyname from pg_policies where tablename in ('batch_jobs','batch_items','batch_tasks','batch_outputs');  -- *_visible_select の 4 行
-- select proname from pg_proc where proname in ('can_view_batch_job','can_view_batch_job_as','batch_path_job','team_batch_limits');  -- 4 行
