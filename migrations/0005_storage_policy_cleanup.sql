-- 0005: Storage ポリシーのクリーンアップ
--
-- 2026-06-13 RLS 監査（project_rls_audit.md / 0004）で検出した、未使用・誤設定の
-- storage.objects ポリシーを除去する。コード依存を grep で検証済み:
--   - クライアントの自前バケット操作は「動画アップロードのみ」(uploadVideoFile / uploadVideoFromUrl → generated-videos)。
--   - 画像アップロードは全てサーバー(service role: save-image / dev-proxy)。
--   - 削除(画像・動画)は全てサーバー(service role: delete-generation)。deleteImage はデッドコード(呼出ゼロ)。
--   - マスクは fal.storage(外部)で自前バケット外。
-- → 下記3ポリシーはどれもクライアントから使われておらず、削除しても機能に影響しない。
--    service role は RLS を迂回するため、サーバー側のアップロード/削除は引き続き動作する。
--
-- ⚠️ これは「適用する」migration。**ステージング → 本番** の順で SQL Editor で実行する。
-- 冪等: drop policy if exists。

begin;

-- 1) 動画DELETE: generated-videos に extension='jpg' 条件 = 誤設定の死んだポリシー（★最優先除去）
drop policy if exists "Users can delete own files 5k69g6_0" on storage.objects;

-- 2) 画像DELETE: foldername[1]=auth.uid() 要求だが実パスは <nodeId>/...（uidでない）→ 実質未使用
--    （クライアント画像削除は存在しない。削除はサーバー service role）
drop policy if exists "Users can delete own files 1yhuiye_0" on storage.objects;

-- 3) 画像INSERT: 同上（uid-folder・未使用）。画像アップロードはサーバー service role のみ
drop policy if exists "Authenticated users can upload 1yhuiye_0" on storage.objects;

-- ※ 動画INSERT "Authenticated users can upload 5k69g6_0"（bucket_id='generated-videos'）は
--   クライアント動画アップロードに必要なため **残す**（drop しない）。

commit;

-- ============================================================
-- 検証クエリ（適用後に実行）
-- ============================================================
-- 残るのは動画INSERTのみ（reads は public バケットのためポリシー不要）になるはず:
-- select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname='storage' and tablename='objects'
--   order by policyname;
-- → "Authenticated users can upload 5k69g6_0"（INSERT / generated-videos）の1件だけ残る。
--
-- 動作確認（ステージング）:
--   - 動画をドラッグ&ドロップ or 生成 → generated-videos に保存できる（動画INSERT 維持の確認）
--   - 画像生成 → 保存できる（サーバー経由なので影響なし）
