-- 0017: ワークフローごとの「チームの編集を許可」と編集ロック（フェーズ B・ユーザー決定 2026-10-03）
--
-- ルール: 所有者は従来どおり編集できる。team_edit=true かつ表示範囲が team/public のワークフローは、同じチームの全員が編集できる。
--        編集は「順番に」行う（編集ロック）: 保存（canvas_data の変更）にはロックの保持が必要。ロックは 90 秒更新が無ければ失効し引き継げる。
--        共有設定・名前などを変えられるのは所有者だけ（トリガで保証）。他チーム・許可オフは従来どおり閲覧とクローンのみ。
-- 前提: 0009（visibility/team_id）・0010（team_members）適用済み。冪等・非破壊。ロールアウト: staging → 本番。

begin;

-- ───────────────────────────────────────────────
-- (1) 列: チームの編集を許可
-- ───────────────────────────────────────────────
alter table public.workflows add column if not exists team_edit boolean not null default false;
-- canvas_data が変わるたびに +1（トリガ）。保存時の衝突確認（読み込んだ版のまま保存できるか）に使う。サムネや設定だけの更新では進まない
alter table public.workflows add column if not exists canvas_version integer not null default 0;

-- ───────────────────────────────────────────────
-- (2) 編集可否（RLS・トリガ・RPC・クライアントで同じ判定を使う）
--     所有者（projects.user_id） or（team_edit かつ team/public かつ同じチームのメンバー）
-- ───────────────────────────────────────────────
create or replace function public.can_edit_workflow_as(p_workflow_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.workflows w
     where w.id = p_workflow_id
       and (
         exists (select 1 from public.projects p where p.id = w.project_id and p.user_id = p_user_id)
         or (
           w.team_edit
           and w.visibility in ('team', 'public')
           and exists (select 1 from public.team_members m where m.team_id = w.team_id and m.user_id = p_user_id)
         )
       )
  )
$$;
revoke all on function public.can_edit_workflow_as(uuid, uuid) from public, anon;
grant execute on function public.can_edit_workflow_as(uuid, uuid) to authenticated, service_role;

create or replace function public.can_edit_workflow(p_workflow_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_workflow_as(p_workflow_id, auth.uid())
$$;
revoke all on function public.can_edit_workflow(uuid) from public, anon;
grant execute on function public.can_edit_workflow(uuid) to authenticated;

-- ───────────────────────────────────────────────
-- (3) 編集ロック（ワークフローにつき 1 行。取得/更新/解放は RPC だけ。閲覧はワークフローが見える人）
-- ───────────────────────────────────────────────
create table if not exists public.workflow_edit_locks (
  workflow_id  uuid primary key references public.workflows(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_email   text,                                   -- 表示用（「○○さんが編集中」）
  session_id   text not null,                          -- タブ単位の識別子（同じ人の別タブを区別）
  acquired_at  timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()      -- 20 秒ごとに更新。90 秒更新が無ければ失効
);
alter table public.workflow_edit_locks enable row level security;
alter table public.workflow_edit_locks replica identity full;   -- Realtime の DELETE 通知に行データを載せる
drop policy if exists "workflow_edit_locks_visible_select" on public.workflow_edit_locks;
create policy "workflow_edit_locks_visible_select" on public.workflow_edit_locks
  for select to authenticated
  using (exists (select 1 from public.workflows w where w.id = workflow_id));   -- workflows の RLS がそのまま効く＝見えるワークフローのロックだけ
-- insert / update / delete のポリシーは作らない（RPC のみ）
revoke insert, update, delete on public.workflow_edit_locks from anon, authenticated;
grant select on public.workflow_edit_locks to authenticated;

-- 取得・更新（heartbeat）。戻り値: {ok:true, holder_user_id, holder_email, session_id, took_over, heartbeat_at, stale_at}
--                             / {ok:false, reason:'forbidden'} / {ok:false, reason:'held', holder_user_id, holder_email, same_user, heartbeat_at, stale_at}
--   p_heartbeat=true: 自分（同じセッション）が持っているときだけ延長する。他が持っていれば奪わずに状態を返す
--   p_heartbeat=false（取得）: 空き・失効・自分の別セッション は取得できる。他人の有効なロックは取得できない
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
revoke all on function public.acquire_workflow_edit_lock(uuid, text, boolean) from public, anon;
grant execute on function public.acquire_workflow_edit_lock(uuid, text, boolean) to authenticated;

-- 解放（自分のセッションのロックだけ）。戻り値: 解放したら true
create or replace function public.release_workflow_edit_lock(p_workflow_id uuid, p_session_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then return false; end if;
  delete from public.workflow_edit_locks where workflow_id = p_workflow_id and user_id = v_uid and session_id = p_session_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.release_workflow_edit_lock(uuid, text) from public, anon;
grant execute on function public.release_workflow_edit_lock(uuid, text) to authenticated;

-- ───────────────────────────────────────────────
-- (4) workflows の UPDATE: 所有者 or 編集者（従来は所有者のみ）
-- ───────────────────────────────────────────────
drop policy if exists "Users can update own workflows" on public.workflows;
drop policy if exists "workflows_editable_update" on public.workflows;
create policy "workflows_editable_update" on public.workflows
  for update to authenticated
  using (public.can_edit_workflow_as(id, auth.uid()))
  with check (public.can_edit_workflow_as(id, auth.uid()));

-- ───────────────────────────────────────────────
-- (5) ガード: 編集者は中身（canvas_data / thumbnail）だけ変えられる。チーム編集のワークフローの canvas_data 変更にはロック保持が必要（所有者も）。
--     updated_at はサーバー時刻にそろえ、canvas_data が変わったら canvas_version を +1。service role（auth.uid() が null）は権限チェックの対象外
-- ───────────────────────────────────────────────
create or replace function public.workflows_shared_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_owner boolean;
begin
  new.updated_at := now();
  if new.canvas_data is distinct from old.canvas_data then new.canvas_version := old.canvas_version + 1; end if;
  if v_uid is null then return new; end if;
  select exists (select 1 from public.projects p where p.id = old.project_id and p.user_id = v_uid) into v_owner;
  if not v_owner then
    if new.project_id is distinct from old.project_id
       or new.team_id is distinct from old.team_id
       or new.visibility is distinct from old.visibility
       or new.is_public is distinct from old.is_public
       or new.team_edit is distinct from old.team_edit
       or new.is_template is distinct from old.is_template
       or new.name is distinct from old.name then
      raise exception 'shared_edit_settings_forbidden' using errcode = '42501', hint = '共有設定や名前を変えられるのはワークフローの所有者だけです';
    end if;
  end if;
  if new.canvas_data is distinct from old.canvas_data and old.team_edit and old.visibility in ('team', 'public') then
    if not exists (
      select 1 from public.workflow_edit_locks l
       where l.workflow_id = old.id and l.user_id = v_uid and l.heartbeat_at > now() - interval '90 seconds'
    ) then
      raise exception 'workflow_edit_lock_required' using errcode = '55P03', hint = '編集ロックを取得してから保存してください';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_workflows_shared_edit_guard on public.workflows;
create trigger trg_workflows_shared_edit_guard
  before update on public.workflows
  for each row execute function public.workflows_shared_edit_guard();

-- ───────────────────────────────────────────────
-- (6) Realtime: ロックの変化を購読可能に（RLS が購読にも効く）
-- ───────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.workflow_edit_locks;
exception when duplicate_object then null; end $$;

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- select column_name from information_schema.columns where table_name='workflows' and column_name in ('team_edit','canvas_version'); -- 2 行
-- select proname from pg_proc where proname in ('can_edit_workflow_as','can_edit_workflow','acquire_workflow_edit_lock','release_workflow_edit_lock','workflows_shared_edit_guard'); -- 5 行
-- select policyname from pg_policies where tablename='workflows' and cmd='UPDATE';                                       -- workflows_editable_update
-- select tgname from pg_trigger where tgname='trg_workflows_shared_edit_guard';                                         -- 1 行
-- select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='workflow_edit_locks';     -- 1 行
