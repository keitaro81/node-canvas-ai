-- 0002: 既存ユーザーの個人チーム自動作成 + generations.team_id バックフィル
--
-- 前提: 0001 適用済み。
-- 方針（メモリ project_team_quota_design.md）:
--   - 全既存ユーザーに「個人チーム（メンバー1人）」を自動作成して所属させる。
--   - 個人チームの月次上限は、現在の app_metadata の quota_image/quota_video を引き継ぐ
--     （未設定なら 100 / 7）。※値の意味が「全期間累計」→「月次」に変わる点に注意。
--   - 過去の generations.team_id を、その user_id の個人チームでバックフィル。
--   - 運営は後から複数ユーザーを1チームに再編する（その際の使用量カウンタ統合は別途運用）。
--
-- 冪等: 既に team_members に所属している（=個人チーム作成済みの）ユーザーはスキップ。
--       再実行しても重複作成しない。

begin;

-- 1. 個人チームの自動作成 + 所属付与
do $$
declare
  u        record;
  v_team   uuid;
  v_qi     integer;
  v_qv     integer;
begin
  for u in
    select id, email, raw_app_meta_data
    from auth.users
  loop
    -- 既にいずれかのチームに所属していればスキップ（冪等性）
    if not exists (select 1 from public.team_members where user_id = u.id) then
      v_qi := coalesce((u.raw_app_meta_data ->> 'quota_image')::integer, 100);
      v_qv := coalesce((u.raw_app_meta_data ->> 'quota_video')::integer, 7);

      insert into public.teams (name, quota_image_monthly, quota_video_monthly)
      values (coalesce(u.email, u.id::text) || ' (個人)', v_qi, v_qv)
      returning id into v_team;

      insert into public.team_members (team_id, user_id, role)
      values (v_team, u.id, 'owner');
    end if;
  end loop;
end $$;

-- 2. generations.team_id バックフィル（user_id → その個人チーム）
--    user_id は全911行で非NULL（事前確認済み）。team_id 未設定の行のみ対象。
update public.generations g
set team_id = tm.team_id
from public.team_members tm
where g.user_id = tm.user_id
  and g.team_id is null;

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================
-- select count(*) from public.teams;                                  -- = auth.users 件数
-- select count(*) from public.team_members;                           -- = auth.users 件数
-- select count(*) from public.generations where team_id is null;      -- = 0
-- select t.name, t.quota_image_monthly, t.quota_video_monthly
--   from public.teams t order by t.name;                              -- 上限が app_metadata から引き継がれているか
