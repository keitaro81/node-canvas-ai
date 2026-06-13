-- 0003: 使用量カウンタの atomic 加算 RPC
--
-- fal proxy（サーバー側クォータ強制）が、生成リクエストを通すたびにこの関数で +1 する。
-- 失敗・キャンセルも消費（合意済み）。並列生成でも競合しないよう upsert + count+1 で atomic に。
-- service role から呼ぶ前提（security definer）。
--
-- 前提: 0001 適用済み（usage_counters テーブル）。冪等: create or replace。

begin;

create or replace function public.increment_usage_counter(
  p_team_id uuid,
  p_user_id uuid,
  p_period  text,
  p_kind    text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage_counters (team_id, user_id, period, kind, count)
  values (p_team_id, p_user_id, p_period, p_kind, 1)
  on conflict (team_id, user_id, period, kind)
  do update set count = public.usage_counters.count + 1;
$$;

-- anon / authenticated からは実行不可（service role のみ）。
revoke all on function public.increment_usage_counter(uuid, uuid, text, text) from public;
revoke all on function public.increment_usage_counter(uuid, uuid, text, text) from anon;
revoke all on function public.increment_usage_counter(uuid, uuid, text, text) from authenticated;

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================
-- select proname from pg_proc where proname = 'increment_usage_counter';  -- 1行
-- -- テスト: 既存の team_id / user_id で呼んでカウントを確認（テスト後は手動で戻す）
-- -- select public.increment_usage_counter('<team_uuid>', '<user_uuid>', '2026-06', 'image');
-- -- select * from public.usage_counters where period = '2026-06';
