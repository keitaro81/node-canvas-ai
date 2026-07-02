-- 0010: チームメンバーシップ管理 MVP — 招待リンク + 1ユーザー1チームの明示enforce
--
-- 前提: 0001-0009 適用済み。spec: docs/specs/team-management-mvp.md
--
-- ⚠️ 当初設計(0001/0002/0003)で既に揃っており「追加不要」なもの:
--   - team_members.role(owner/admin/member) … 既存。0002 で個人チーム本人は role='owner' 済み。
--   - usage_counters は PK (team_id,user_id,period,kind) で既に user_id 粒度。increment_usage_counter も user_id 単位。
--       → 支店キャップ = team で SUM(count)（既存判定どおり）／個人別可視化 = user_id で GROUP BY（データは既にある）。
--       → 将来の「個人別キャップ」も team_members に上限列＋判定を足すだけ（データ確保済み）。
--   - teams.name 既存。team_members/usage_counters の SELECT RLS（is_team_member）既存。
-- よって本 migration は「招待リンク」と「1ユーザー1チームの enforce」のみ。
--
-- 冪等: create ... if not exists / drop policy if exists。非破壊。
-- ロールアウト: L1/L2 同型。staging+本番 両DBに先行適用 → コードデプロイ → 検証。

begin;

-- ───────────────────────────────────────────────
-- (1) team_invites: 共有招待リンク（opt-in 参加）
-- ───────────────────────────────────────────────
create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'), -- 48hex=192bit・URL安全
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  revoked_at  timestamptz
);
create index if not exists team_invites_token_idx on public.team_invites(token);
-- 1チーム1アクティブリンク（再発行 = 旧を revoke → 新を insert）。期限切れ判定は使用時。
create unique index if not exists team_invites_one_active
  on public.team_invites(team_id) where revoked_at is null;

-- ───────────────────────────────────────────────
-- (2) 1ユーザー = 1チーム を明示enforce
--   0001 の PK は (team_id,user_id) で複数チーム所属が可能だが、本機能は「参加=移動(update)」前提。
--   現データは全員1チーム(確認済み)なので作成は失敗しない。
--   将来 multi-team にするなら、この unique index を drop すれば戻せる。
-- ───────────────────────────────────────────────
create unique index if not exists team_members_user_id_unique
  on public.team_members(user_id);

-- ───────────────────────────────────────────────
-- (3) RLS: team_invites は当該チームの owner のみ SELECT 可（リンク表示用）。
--   INSERT/UPDATE(発行・失効) は service role の /api/team/invite 経由（revoke→insert の原子性）。
--   join はサーバーが service role で token を検証して読むため、クライアントの invite SELECT を owner に
--   限定 = token からのチーム列挙攻撃を防ぐ。
-- ───────────────────────────────────────────────
alter table public.team_invites enable row level security;

drop policy if exists team_invites_owner_select on public.team_invites;
create policy team_invites_owner_select on public.team_invites
  for select to authenticated
  using (team_id in (
    select team_id from public.team_members
    where user_id = auth.uid() and role = 'owner'
  ));
-- INSERT/UPDATE/DELETE ポリシーは作らない = authenticated 不可。service role のみ。

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='team_invites';                 -- 7列
-- select indexname from pg_indexes
--   where tablename in ('team_invites','team_members')
--     and indexname in ('team_invites_one_active','team_members_user_id_unique'); -- 2行
-- select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='team_invites';                     -- SELECT 1件のみ
-- -- 1チーム固定の確認（複数所属が居たら index 作成で失敗する）:
-- select user_id, count(*) from public.team_members group by user_id having count(*) > 1;  -- 0行
