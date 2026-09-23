-- 0013: ReviewGrid（撮影後工程 Step 7）— ジョブ単位のレイアウト設定の上書き・出力の記録に「種類」を追加
--
-- 設計: 仕様書 v4 §5（ReviewGrid）/ §4-10（サーバー側レイアウトへの移行に備える）。
-- 前提: 0011・0012 適用済み。冪等: if not exists / drop … if exists / create or replace。非破壊（既存列は変更しない）。
-- ロールアウト: staging → 本番 の順に SQL Editor で実行。

begin;

-- ───────────────────────────────────────────────
-- (1) batch_jobs.layout_overrides: ジョブ画面で変更したバリアント設定（Product Layout ノード ID → LayoutParams）
--     写し（workflow_snapshot）は投入時のまま保持し、表示・書き出しは 上書き ?? 写し を使う（fal は呼ばない）
-- ───────────────────────────────────────────────
alter table public.batch_jobs add column if not exists layout_overrides jsonb not null default '{}'::jsonb;

-- 所属メンバーなら誰でも変更できる（確認結果と同じ扱い）。列を絞った RPC 経由のみ
create or replace function public.set_batch_job_layout(p_job_id uuid, p_overrides jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  if p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then raise exception 'invalid overrides'; end if;
  select team_id into v_team from public.batch_jobs where id = p_job_id;
  if v_team is null or not public.is_team_member(v_team) then raise exception 'forbidden'; end if;
  update public.batch_jobs set layout_overrides = p_overrides, updated_at = now() where id = p_job_id;
end $$;
revoke all on function public.set_batch_job_layout(uuid, jsonb) from public, anon;
grant execute on function public.set_batch_job_layout(uuid, jsonb) to authenticated;

-- ───────────────────────────────────────────────
-- (2) batch_outputs.kind: 'full'（フル解像度の出力）/ 'thumb'（一覧用サムネイル・長辺 400px）
--     一意性は (item, variant, layout_hash, kind)。サムネイルは識別値が同じなら作り直さない（§4-10）
-- ───────────────────────────────────────────────
alter table public.batch_outputs add column if not exists kind text not null default 'full';
do $$ begin
  alter table public.batch_outputs add constraint batch_outputs_kind_check check (kind in ('full','thumb'));
exception when duplicate_object then null; end $$;
alter table public.batch_outputs drop constraint if exists batch_outputs_item_id_variant_layout_hash_key;
do $$ begin
  alter table public.batch_outputs add constraint batch_outputs_item_variant_hash_kind_key unique (item_id, variant, layout_hash, kind);
exception when duplicate_object then null; end $$;
create index if not exists batch_outputs_item_kind_idx on public.batch_outputs(item_id, kind);

-- 記録 RPC: 種類を受け取る版に置き換える（4 引数版は未使用のため削除）
drop function if exists public.record_batch_output(uuid, text, text, text);
create or replace function public.record_batch_output(p_item_id uuid, p_variant text, p_layout_hash text, p_output_path text, p_kind text default 'full')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_id uuid;
begin
  if p_kind not in ('full','thumb') then raise exception 'invalid kind: %', p_kind; end if;
  select team_id into v_team from public.batch_items where id = p_item_id;
  if v_team is null or not public.is_team_member(v_team) then raise exception 'forbidden'; end if;
  -- 保存先は自チームのフォルダに限る（他チームのパスを記録させない）
  if position((v_team::text || '/') in p_output_path) <> 1 then raise exception 'invalid path'; end if;
  insert into public.batch_outputs (item_id, team_id, variant, layout_hash, output_path, executor, kind)
  values (p_item_id, v_team, p_variant, p_layout_hash, p_output_path, 'browser', p_kind)
  on conflict (item_id, variant, layout_hash, kind) do update set output_path = excluded.output_path
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_batch_output(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_batch_output(uuid, text, text, text, text) to authenticated;

commit;

-- ============================================================
-- 検証クエリ（適用後に手動実行）
-- ============================================================
-- select column_name from information_schema.columns where table_name='batch_jobs' and column_name='layout_overrides';           -- 1行
-- select column_name from information_schema.columns where table_name='batch_outputs' and column_name='kind';                    -- 1行
-- select conname from pg_constraint where conrelid='public.batch_outputs'::regclass and contype='u';                              -- batch_outputs_item_variant_hash_kind_key
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname in ('set_batch_job_layout','record_batch_output'); -- 2行（record は 5 引数）
