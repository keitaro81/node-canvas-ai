-- 0007: generated-images へのクライアントアップロードを許可（16c: 参照画像・マスクの永続保存）
--
-- 16c で参照画像/マスクを fal.storage → 自前 generated-images バケットに移すため、
-- 認証ユーザーのクライアントアップロードを許可する。
-- generated-videos の既存 INSERT ポリシー（"Authenticated users can upload 5k69g6_0"・bucket スコープ）と同じ形。
-- 注: 0005 で削除した旧ポリシーは foldername[1]=auth.uid() 要求で実パス（<id>/...）と不一致＝非機能だった。
--     本ポリシーは bucket スコープで正しく機能する。
--
-- ⚠️ 適用する migration。**コードデプロイ前に**ステージング・本番へ。冪等: drop if exists + create。
-- 削除はサーバー（service role）のみ。読み取りは public バケットのため不要。

begin;

drop policy if exists "Authenticated can upload to generated-images" on storage.objects;
create policy "Authenticated can upload to generated-images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'generated-images');

commit;

-- 検証: select policyname, cmd, roles from pg_policies
--   where schemaname='storage' and tablename='objects' order by policyname;
-- → generated-images INSERT と generated-videos INSERT の2件になる。
