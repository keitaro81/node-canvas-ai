-- 0008: generated-images / generated-videos を private 化し、認証ユーザーの署名URL読み取りを許可（バケット非公開化 L1）
--
-- 目的: 公開URLでの非ログイン閲覧・URL流出・検索インデックスを遮断する。
-- 方式: バケットを private にし、ログイン済みユーザーは createSignedUrl で短命の署名URLを発行して閲覧する。
--   - DB保存形は従来どおり /object/public/<bucket>/<path>（canonical 識別子）。アプリが読込口で署名URL化する。
--   - L1 スコープ: 認証ユーザーは全オブジェクトを読める（テナント分離=他テナントの生成物を隠す=L2 は対象外）。
--
-- ⚠️ 適用順（後方互換ロールアウト・コードとDBを分離）:
--   1) (A) SELECT ポリシーを **ステージング・本番の両方に先に** 適用する（バケットは public のまま）。
--   2) 新コード（読込口で署名・書込口で canonical 化）をデプロイし、public のまま動作確認する
--      （署名URLは public バケットでも機能する）。
--   3) 動作確認後に **(B) を実行してバケットを private 化する**（カットオーバー）。staging → 本番の順。
--   ロールバックは (B) を `public = true` に戻すだけ（データ変更なし）。
-- 注: ローカル dev は本番DBを読むため、(A) を本番に入れておけば dev も署名URLで動作する
--     （本番を private 化するまで raw も生存＝rollout 中の dev 安全）。
--
-- 既存への影響なし:
--   - INSERT ポリシー（0007 の generated-images / 既存の generated-videos）→ visibility 変更は INSERT に無関係。
--   - service role のサーバーアップロード（save-image Edge / vite dev proxy）→ RLS バイパスのため影響なし。
--   - list_generated_objects() RPC（0006・security definer）→ 孤児/保存期間 cron は引き続き動作。
--   - クライアント DELETE は無し（削除はサーバー service role）。
--
-- 冪等: (A) は drop if exists + create。(B) は同値再実行で no-op。

-- ───────────────────────────────────────────────
-- (A) 認証ユーザーの SELECT（読み取り）を両バケットに許可
--     → クライアント createSignedUrl(s) が機能するために必要。
-- ───────────────────────────────────────────────
begin;

drop policy if exists "Authenticated can read generated-images" on storage.objects;
create policy "Authenticated can read generated-images" on storage.objects
  for select to authenticated
  using (bucket_id = 'generated-images');

drop policy if exists "Authenticated can read generated-videos" on storage.objects;
create policy "Authenticated can read generated-videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'generated-videos');

commit;

-- (A) 検証: storage.objects のポリシーが INSERT×2 + SELECT×2 = 4件になる
-- select policyname, cmd, roles from pg_policies
--   where schemaname='storage' and tablename='objects' order by policyname;


-- ───────────────────────────────────────────────
-- (B) バケットを private 化（カットオーバー）。
--     ※ (A) 適用 + 新コードデプロイ + public のままの動作確認が済んでから、下の update を実行する。
--        （このファイルを丸ごと貼って実行すると (A) のみ適用される＝安全側。）
-- ───────────────────────────────────────────────
-- update storage.buckets set public = false
--   where id in ('generated-images', 'generated-videos');

-- (B) 検証: 両バケットが public=false になる
-- select id, public from storage.buckets where id in ('generated-images','generated-videos');
-- 追加検証（任意）: ログアウト/incognito で raw 公開URL
--   https://<proj>.supabase.co/storage/v1/object/public/generated-images/<path>
--   を開く → 400/denied（private 化前は 200）。

-- ───────────────────────────────────────────────
-- 将来（本 migration には含めない）: 「明示公開」アセット用の public-media バケット（L2）。
--   公開ギャラリー/共有リンク等の非ログイン閲覧が必要になった時に、別の public バケット＋
--   publishAsset() で対象だけを複製する。private な本2バケットには anon SELECT を足さない。
-- ───────────────────────────────────────────────
