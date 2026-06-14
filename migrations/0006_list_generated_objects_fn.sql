-- 0006: 孤児ストレージGC用に storage.objects を1クエリで列挙する RPC
--
-- storage スキーマは PostgREST に公開されないため、生成物バケットのオブジェクト一覧を
-- security definer 関数で返す。Edge 関数からの Storage list は N+1（フォルダごと）で
-- タイムアウトするため、これで一括取得して高速化する。service role からのみ呼ぶ。
--
-- ⚠️ 適用する migration。ステージング → 本番 の順で実行。冪等: create or replace。

begin;

create or replace function public.list_generated_objects()
returns table(bucket_id text, name text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name, o.created_at
  from storage.objects o
  where o.bucket_id in ('generated-images', 'generated-videos');
$$;

-- anon / authenticated からは実行不可（service role のみ）
revoke all on function public.list_generated_objects() from public;
revoke all on function public.list_generated_objects() from anon;
revoke all on function public.list_generated_objects() from authenticated;

commit;

-- 検証: select count(*) from public.list_generated_objects();  -- バケット内の総オブジェクト数
