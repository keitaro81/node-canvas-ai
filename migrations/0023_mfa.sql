-- 0023: 2 段階認証（MFA）の強制（2026-11-14・設計 docs/specs/two-factor-auth.md）。
--
-- 規則は 1 つ: 「本人が検証済みの要素（認証アプリ）を持つ、または所属チームが必須」なのに aal2 でないセッションは、データに触れない。
--   (1) teams.require_mfa               … チームのオーナーが「このチームは 2 段階認証を必須にする」
--   (2) public.mfa_satisfied()          … 規則の判定（JWT の aal・auth.mfa_factors・teams.require_mfa）
--   (3) public.mfa_status()             … 画面用（aal1 のままでも呼べる。必須か・登録済みか）
--   (4) team_requires_mfa / team_mfa_overview … Edge Functions（service role）用
--   (5) public.mfa_events               … リセット・必須の切り替えの記録（service role だけが読み書き）
--   (6) 自己確認                         … ここで失敗したら、全体が取り消される（何も変わらない）
--   (7) mfa_gate ポリシー                … RLS のある全テーブルと storage.objects に「加えて満たす条件」（restrictive）
--   (8) RLS を通らない RPC               … 同じ条件を入れる（確認結果・出力の記録・レイアウト保存・編集ロック・本日の利用数・ライブラリの最終利用）
--
-- 適用しただけでは誰も止まらない: 要素を持たず、チームも必須でないユーザーは mfa_satisfied() が常に true。
-- service role（Edge Functions・cron）と未ログイン（anon）も true（auth.uid() が null）。
-- 既存のポリシーは変えない。restrictive は既存の許可に AND で重なるだけ。
--
-- 前提: 0001〜0022 適用済み。staging → 本番の順に SQL Editor で、このファイル全体を 1 回で実行する
-- （drop policy if exists があるので「破壊的操作」の警告が出るが安全。begin〜commit の 1 トランザクション）。
-- 戻し方はファイル末尾。

begin;

-- ───────────────────────────────────────────────
-- (1) チームの必須フラグ（書き込みは Edge の team/manage だけ。teams にクライアントの UPDATE ポリシーは無い）
-- ───────────────────────────────────────────────
alter table public.teams add column if not exists require_mfa boolean not null default false;

-- ───────────────────────────────────────────────
-- (2) 規則の判定。security definer（auth.mfa_factors と team_members を RLS なしで読む）・search_path 固定
-- ───────────────────────────────────────────────
create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    or not (
      exists (select 1 from auth.mfa_factors f
               where f.user_id = auth.uid() and f.status = 'verified')
      or exists (select 1 from public.team_members m
                   join public.teams t on t.id = m.team_id
                  where m.user_id = auth.uid() and t.require_mfa)
    )
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

-- ───────────────────────────────────────────────
-- (3) 画面用の状態。(7) のせいで aal1 のままではチームの行が読めないので、関数で返す
-- ───────────────────────────────────────────────
create or replace function public.mfa_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'required_by_team', exists (select 1 from public.team_members m
                                  join public.teams t on t.id = m.team_id
                                 where m.user_id = auth.uid() and t.require_mfa),
    'has_factor', exists (select 1 from auth.mfa_factors f
                           where f.user_id = auth.uid() and f.status = 'verified'),
    'aal', coalesce(auth.jwt()->>'aal', 'aal1')
  )
$$;
revoke all on function public.mfa_status() from public, anon;
grant execute on function public.mfa_status() to authenticated;

-- ───────────────────────────────────────────────
-- (4) Edge Functions 用（service role だけ）
-- ───────────────────────────────────────────────
-- その人の所属チームが必須にしているか（api/_auth.ts の teamRequiresMfa）
create or replace function public.team_requires_mfa(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m
                   join public.teams t on t.id = m.team_id
                  where m.user_id = p_user_id and t.require_mfa)
$$;
revoke all on function public.team_requires_mfa(uuid) from public, anon, authenticated;
grant execute on function public.team_requires_mfa(uuid) to service_role;

-- チームのメンバーごとの「認証アプリを登録済みか」（チーム設定の一覧）
create or replace function public.team_mfa_overview(p_team_id uuid)
returns table (user_id uuid, has_factor boolean) language sql stable security definer set search_path = '' as $$
  select m.user_id,
         exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified')
    from public.team_members m
   where m.team_id = p_team_id
$$;
revoke all on function public.team_mfa_overview(uuid) from public, anon, authenticated;
grant execute on function public.team_mfa_overview(uuid) to service_role;

-- ───────────────────────────────────────────────
-- (5) 操作の記録（オーナー / 運営によるリセット・必須の切り替え）。ポリシーなし = service role だけ
-- ───────────────────────────────────────────────
create table if not exists public.mfa_events (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor_id       uuid,                 -- 操作した人（オーナー / 運営）
  target_user_id uuid,                 -- リセットされた人（必須の切り替えでは null）
  team_id        uuid,
  action         text not null check (action in ('reset_by_owner', 'reset_by_operator', 'require_on', 'require_off')),
  detail         jsonb not null default '{}'::jsonb
);
create index if not exists mfa_events_team_idx on public.mfa_events (team_id, created_at desc);
alter table public.mfa_events enable row level security;

-- ───────────────────────────────────────────────
-- (6) 自己確認: 「要素もチームの必須も無い、ログイン済み（aal1）のユーザー」として関数を呼ぶ。
--     true / false,false が返らなければ（auth.mfa_factors を読めない等）例外 → トランザクション全体が取り消される
-- ───────────────────────────────────────────────
do $$
declare v_ok boolean; v_status jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal1"}', true);
  set local role authenticated;
  v_ok := public.mfa_satisfied();
  v_status := public.mfa_status();
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if v_ok is not true then
    raise exception 'mfa self-check failed: mfa_satisfied() = % （要素もチームの必須も無いユーザーは true のはず）', v_ok;
  end if;
  if (v_status->>'has_factor')::boolean or (v_status->>'required_by_team')::boolean or v_status->>'aal' <> 'aal1' then
    raise exception 'mfa self-check failed: mfa_status() = %', v_status;
  end if;
end $$;

-- ───────────────────────────────────────────────
-- (7) RLS が有効な public の全テーブルと storage.objects に、同じ条件を restrictive で足す。
--     (select …) で包むので、行ごとではなく文ごとに 1 回だけ評価される
-- ───────────────────────────────────────────────
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname <> 'mfa_events'   -- ポリシーなし（service role だけ）なので不要
     order by c.relname
  loop
    execute format('drop policy if exists mfa_gate on public.%I', t.relname);
    execute format(
      'create policy mfa_gate on public.%I as restrictive for all to authenticated '
      'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))', t.relname);
  end loop;
end $$;

drop policy if exists mfa_gate on storage.objects;
create policy mfa_gate on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- ───────────────────────────────────────────────
-- (8) RLS を通らない（security definer の）RPC にも同じ条件を入れる。
--     本体は 0016 / 0017 / 0019 / 0020 のまま、「mfa_satisfied でなければ断る」を足すだけ。
--     判定用の can_view_batch_job / can_edit_workflow（と _as 版）は変えない: RLS のポリシーが行ごとに呼ぶので、
--     ここへ足すと一覧が遅くなる。RLS 経由の読み書きは (7) で止まり、この 2 つを直接呼んで返るのは可否の真偽だけ。
--     release_workflow_edit_lock（自分のロックを手放すだけ）と is_team_member（自分の所属の真偽だけ）も変えない
-- ───────────────────────────────────────────────
-- 確認結果の記録（ジョブが見える人）: 0016 の本体 ＋ 先頭の 1 行
create or replace function public.review_batch_item(p_item_id uuid, p_review text)
returns void language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  if not public.mfa_satisfied() then raise exception 'forbidden'; end if;
  if p_review not in ('unreviewed','ok','ng') then raise exception 'invalid review: %', p_review; end if;
  select job_id into v_job from public.batch_items where id = p_item_id;
  if v_job is null or not public.can_view_batch_job(v_job) then raise exception 'forbidden'; end if;
  update public.batch_items set review = p_review, reviewed_by = auth.uid(), updated_at = now() where id = p_item_id;
end $$;

-- 出力の記録（ジョブが見える人）: 0016 の本体 ＋ 先頭の 1 行
create or replace function public.record_batch_output(p_item_id uuid, p_variant text, p_layout_hash text, p_output_path text, p_kind text default 'full')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_job uuid; v_id uuid;
begin
  if not public.mfa_satisfied() then raise exception 'forbidden'; end if;
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

-- レイアウト設定の保存（作成者だけ）: 0016 の本体 ＋ 先頭の 1 行
create or replace function public.set_batch_job_layout(p_job_id uuid, p_overrides jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  if not public.mfa_satisfied() then raise exception 'forbidden'; end if;
  if p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then raise exception 'invalid overrides'; end if;
  select created_by into v_creator from public.batch_jobs where id = p_job_id;
  if v_creator is null or v_creator <> auth.uid() then raise exception 'forbidden'; end if;
  update public.batch_jobs set layout_overrides = p_overrides, updated_at = now() where id = p_job_id;
end $$;

-- 編集ロックの取得・更新: 0017 の本体 ＋ 「mfa_satisfied でなければ forbidden」の 1 行
create or replace function public.acquire_workflow_edit_lock(p_workflow_id uuid, p_session_id text, p_heartbeat boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_lock  public.workflow_edit_locks%rowtype;
  v_email text;
  v_stale constant interval := interval '90 seconds';
  v_found boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 100 then raise exception 'invalid_session' using errcode = '22023'; end if;
  if not public.mfa_satisfied() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not public.can_edit_workflow_as(p_workflow_id, v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('workflow_edit_lock:' || p_workflow_id::text));
  select * into v_lock from public.workflow_edit_locks where workflow_id = p_workflow_id for update;
  v_found := found;
  if v_found and v_lock.heartbeat_at > now() - v_stale then
    -- 有効なロックがある
    if v_lock.user_id = v_uid and v_lock.session_id = p_session_id then
      update public.workflow_edit_locks set heartbeat_at = now() where workflow_id = p_workflow_id;
      return jsonb_build_object('ok', true, 'holder_user_id', v_uid, 'holder_email', v_lock.user_email, 'session_id', p_session_id,
                                'took_over', false, 'heartbeat_at', now(), 'stale_at', now() + v_stale);
    end if;
    if p_heartbeat or v_lock.user_id <> v_uid then
      return jsonb_build_object('ok', false, 'reason', 'held', 'holder_user_id', v_lock.user_id, 'holder_email', v_lock.user_email,
                                'same_user', v_lock.user_id = v_uid, 'heartbeat_at', v_lock.heartbeat_at, 'stale_at', v_lock.heartbeat_at + v_stale);
    end if;
    -- 自分の別セッション → 取得して引き継ぐ（古いタブは次の heartbeat で閲覧のみになる）
  end if;
  if p_heartbeat then
    -- 持っていないロックは heartbeat では取らない（空き/失効なら free を返す）
    return jsonb_build_object('ok', false, 'reason', 'free');
  end if;
  select email into v_email from auth.users where id = v_uid;
  insert into public.workflow_edit_locks (workflow_id, user_id, user_email, session_id, acquired_at, heartbeat_at)
  values (p_workflow_id, v_uid, v_email, p_session_id, now(), now())
  on conflict (workflow_id) do update
    set user_id = excluded.user_id, user_email = excluded.user_email, session_id = excluded.session_id, acquired_at = now(), heartbeat_at = now();
  return jsonb_build_object('ok', true, 'holder_user_id', v_uid, 'holder_email', v_email, 'session_id', p_session_id,
                            'took_over', v_found, 'heartbeat_at', now(), 'stale_at', now() + v_stale);
end $$;

-- 本日の利用数（チーム全体）: 0019 の本体 ＋ 先頭の 1 行（満たしていなければ、チーム無しと同じ null）
create or replace function public.team_batch_limits()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_team uuid; v_used int; v_used_videos int; v_active int; v_limit int; v_video_limit int; v_day_start timestamptz;
begin
  if not public.mfa_satisfied() then return null; end if;
  select team_id into v_team from public.team_members where user_id = auth.uid() limit 1;
  if v_team is null then return null; end if;
  select daily_item_limit, daily_video_limit into v_limit, v_video_limit from public.teams where id = v_team;
  v_day_start := ((now() at time zone 'Asia/Tokyo')::date)::timestamp at time zone 'Asia/Tokyo';
  select coalesce(sum(item_count), 0) into v_used from public.batch_jobs where team_id = v_team and status <> 'cancelled' and created_at >= v_day_start and kind <> 'video';
  select coalesce(sum(item_count), 0) into v_used_videos from public.batch_jobs where team_id = v_team and status <> 'cancelled' and created_at >= v_day_start and kind = 'video';
  select count(*) into v_active from public.batch_jobs where team_id = v_team and status in ('uploading','submitted','processing');
  return jsonb_build_object('used_today', v_used, 'active_jobs', v_active, 'daily_limit', coalesce(v_limit, 300), 'used_videos_today', v_used_videos, 'daily_video_limit', coalesce(v_video_limit, 20));
end $$;

-- ライブラリの最終利用の記録: 0020 の本体 ＋ 条件 1 行（(select …) で包み、文ごとに 1 回だけ評価）
create or replace function public.library_touch(p_ids uuid[])
returns void
language sql security definer set search_path = public as $$
  update public.library_items
     set last_used_at = now()
   where id = any(p_ids)
     and (select public.mfa_satisfied())
     and (user_id = auth.uid() or (visibility = 'team' and public.is_team_member(team_id)));
$$;

commit;

-- ───────────────────────────────────────────────
-- 確認（適用後に 1 つずつ実行）
-- ───────────────────────────────────────────────
-- 1) 列と関数:
--    select column_name from information_schema.columns where table_name = 'teams' and column_name = 'require_mfa';   -- 1 行
--    select proname from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('mfa_satisfied','mfa_status','team_requires_mfa','team_mfa_overview') order by 1;               -- 4 行
-- 2) ポリシー: RLS のある public の全テーブル（mfa_events 以外）と storage.objects に mfa_gate が 1 つずつ
--    select schemaname, tablename, permissive, roles from pg_policies where policyname = 'mfa_gate' order by 1, 2;    -- permissive = RESTRICTIVE
--    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname <> 'mfa_events'
--       and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'mfa_gate');   -- 0 行
-- 3) いまの状態（誰も必須にしていない・登録済みの人数）:
--    select count(*) filter (where require_mfa) as teams_required, count(*) as teams from public.teams;
--    select count(distinct user_id) as users_with_factor from auth.mfa_factors where status = 'verified';
-- 4) アプリを開いて、いつもどおりワークフローの一覧が出ること（要素なし・必須なしの人は何も変わらない）

-- ───────────────────────────────────────────────
-- 戻し方
-- ───────────────────────────────────────────────
-- A) DB 側の強制をすべて止める（1 文・すぐ効く。ポリシーも RPC もそのままで、判定だけが常に true になる）:
--      create or replace function public.mfa_satisfied() returns boolean
--        language sql stable security definer set search_path = '' as $$ select true $$;
--    再開するときは、このファイルの (2) の create or replace function public.mfa_satisfied() … をもう一度実行する。
--    ※ Edge Functions 側の確認（api/_auth.ts）は別に動いている。あわせて止めるなら B（チームの必須）と C（個人の登録）。
-- B) 特定のチームの必須だけを外す:
--      update public.teams set require_mfa = false where id = '<team id>';
-- C) 特定の人の登録を消す（ロックアウトの救済。通常は /admin の「2 段階認証をリセット」を使う）:
--      delete from auth.mfa_factors where user_id = '<user id>';
-- D) ポリシーごと消す（A で足りるので通常は不要）:
--      do $$ declare t record; begin
--        for t in select tablename from pg_policies where schemaname = 'public' and policyname = 'mfa_gate' loop
--          execute format('drop policy if exists mfa_gate on public.%I', t.tablename);
--        end loop;
--      end $$;
--      drop policy if exists mfa_gate on storage.objects;
--    RPC（review_batch_item / record_batch_output / set_batch_job_layout / acquire_workflow_edit_lock /
--    team_batch_limits / library_touch）は 0016 / 0017 / 0019 / 0020 の定義を再実行すれば、条件の無い版に戻る。
