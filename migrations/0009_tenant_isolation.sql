-- 0009: テナント分離（L2）— ワークフロー可視性(private/team/public) + チームスコープ署名
--
-- 目的: L1（バケット非公開化）の上に、メディアの読取/署名を **テナント=チーム境界**で制限し、
--   ワークフロー単位のオプトイン共有（private 既定 / team / public）を導入する。
-- 方式: 署名は service role の `/api/storage/sign-media` のみが行う（クライアント createSignedUrl を封じる）。
--   エンドポイントが「そのメディアが属するワークフローに呼び出し者がアクセスできるか」で認可する。
--   アクセス可 = 所有者 OR visibility='public' OR (visibility='team' AND 同チーム)。
--
-- ⚠️ 適用順（後方互換ロールアウト・コードと分離。L1/0008 と同型）:
--   1) (A) スキーマ＋RLS緩和＋RPC を **staging・本番 両DB**に先に適用（非破壊＝既存挙動不変）。
--   2) 新コード（sign-media エンドポイント＋クライアント rewire＋共有UI）をデプロイし検証
--      （この時点では 0008 の blanket SELECT が残っているのでクライアント署名も動く＝壊れない）。
--   3) 2テナントのクロステナント否定テスト後、**(B) を実行して blanket SELECT を drop**（カットオーバー）。
--   ロールバック = (B) の SELECT ポリシーを再作成（0008 と同じ）。
--
-- 冪等: drop ... if exists + create。ADD COLUMN IF NOT EXISTS。

-- ───────────────────────────────────────────────
-- (A-1) workflows に team_id（所有チーム）と visibility を追加
-- ───────────────────────────────────────────────
begin;

alter table public.workflows add column if not exists team_id uuid references public.teams(id);
create index if not exists idx_workflows_team_id on public.workflows(team_id);

-- visibility: private(既定) / team / public
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='workflows' and column_name='visibility') then
    alter table public.workflows add column visibility text not null default 'private'
      check (visibility in ('private','team','public'));
  end if;
end $$;

-- バックフィル: team_id = ワークフロー所有者(project.user_id)のチーム
update public.workflows w
set team_id = tm.team_id
from public.projects p
join public.team_members tm on tm.user_id = p.user_id
where w.project_id = p.id and w.team_id is null;

-- バックフィル: 既存 is_public=true → visibility='public'
update public.workflows set visibility = 'public' where is_public = true and visibility <> 'public';

commit;

-- ───────────────────────────────────────────────
-- (A-1b) 新規ワークフローに team_id を自動設定（作成者のチーム）。createWorkflow/cloneWorkflow でクライアント変更不要。
-- ───────────────────────────────────────────────
begin;
create or replace function public.set_workflow_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is null then
    new.team_id := (select team_id from public.team_members where user_id = auth.uid() limit 1);
  end if;
  return new;
end $$;
drop trigger if exists trg_set_workflow_team_id on public.workflows;
create trigger trg_set_workflow_team_id before insert on public.workflows
  for each row execute function public.set_workflow_team_id();
commit;

-- ───────────────────────────────────────────────
-- (A-2) RLS 緩和（is_team_member()[0001] 再利用）
--   ※ 移行期の安全のため visibility と is_public の両方を見る（旧コードが is_public を書いても機能）。
-- ───────────────────────────────────────────────
begin;

-- workflows SELECT: 所有者 OR public OR (team AND メンバー)
drop policy if exists "Users can view own and public workflows" on public.workflows;
create policy "Users can view own and public workflows" on public.workflows
  for select to authenticated
  using (
    project_id in (select projects.id from public.projects where projects.user_id = auth.uid())
    or visibility = 'public' or is_public = true
    or (visibility = 'team' and public.is_team_member(team_id))
  );

-- generations SELECT 追加: 共有(team/public)ワークフローの生成物も閲覧可（共有WFの History 表示用）。
-- 既存の own 2系統（workflow所有・user_id）は据置（OR 合成）。
drop policy if exists "Users can view shared workflow generations" on public.generations;
create policy "Users can view shared workflow generations" on public.generations
  for select to authenticated
  using (workflow_id in (
    select w.id from public.workflows w
    where w.visibility = 'public' or w.is_public = true
       or (w.visibility = 'team' and public.is_team_member(w.team_id))
  ));

-- workflows UPDATE/DELETE/INSERT は据置（所有者のみ＝共有は閲覧のみ・編集は所有者）。

commit;

-- ───────────────────────────────────────────────
-- (A-3) RPC: 呼び出し者が owner のストレージキーのみ返す（即時表示の所有者検証用）
--   sign-media の ownUrls で使用。service role が p_user(検証済みJWTのuid)を渡して呼ぶ。
--   クライアントから直接呼べないよう anon/authenticated の execute を剥奪。
-- ───────────────────────────────────────────────
begin;

create or replace function public.storage_keys_owned_by(p_user uuid, p_keys text[])
returns setof text
language sql
security definer
stable
set search_path = storage, public
as $$
  select o.bucket_id || '/' || o.name
  from storage.objects o
  where o.owner = p_user
    and (o.bucket_id || '/' || o.name) = any(p_keys);
$$;

revoke execute on function public.storage_keys_owned_by(uuid, text[]) from public, anon, authenticated;
grant execute on function public.storage_keys_owned_by(uuid, text[]) to service_role;

commit;

-- (A) 検証:
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='workflows' and column_name in ('team_id','visibility');
--   select count(*) filter (where team_id is null) as null_team, count(*) from public.workflows;  -- null_team は team未所属の古データのみ
--   select visibility, count(*) from public.workflows group by visibility;


-- ───────────────────────────────────────────────
-- (B) カットオーバー: 0008 の blanket authenticated SELECT を drop（コードデプロイ＋検証後に別途実行）。
--     これ以降、クライアント createSignedUrl は不可＝署名は sign-media（service role）のみ。
--     INSERT ポリシー（クライアントアップロード）は残す。
--     ※ このファイルを丸ごと貼ると (A) のみ適用＝安全側。下を手動で実行してカットオーバー。
-- ───────────────────────────────────────────────
-- begin;
-- drop policy if exists "Authenticated can read generated-images" on storage.objects;
-- drop policy if exists "Authenticated can read generated-videos" on storage.objects;
-- commit;

-- (B) 検証: storage.objects の SELECT ポリシーが 0 件になる（INSERT は残る）
--   select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' order by cmd, policyname;
-- 否定テスト: ユーザーB の JWT で createSignedUrl(A の private パス) → 拒否。

-- ロールバック（(B) を戻す）= 0008(A) の2ポリシーを再作成:
--   create policy "Authenticated can read generated-images" on storage.objects for select to authenticated using (bucket_id = 'generated-images');
--   create policy "Authenticated can read generated-videos" on storage.objects for select to authenticated using (bucket_id = 'generated-videos');
