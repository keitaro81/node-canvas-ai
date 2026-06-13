-- 0004: RLS ポリシー現状スナップショット（IaC・ドキュメント）
--
-- 2026-06-13 の本番監査で確認した RLS の現状をリポジトリの真実として固定する。
-- 監査結論: 重大な穴なし。RLS は全テーブル有効、ポリシーは所有者/チームにスコープ。
-- （詳細・改善点はメモリ project_rls_audit.md）
--
-- ⚠️ これは「ドキュメント/新規DB再現用」。**既に本ポリシーを持つ本番/ステージングでは実行しない**こと
--    （drop+create で一瞬ポリシーが消える＝瞬間的なRLSギャップになる）。
--    新規環境の再現、または環境間ドリフトの diff 基準として使う。
--
-- ★ = 監査でフラグした「要クリーンアップ」項目（別途 cleanup migration で対応予定。本スナップショットは現状を忠実に記録）。
-- VERIFY = 監査時に式の一部が画面外で、標準パターンで再構成。本番から正確に出すには pg_policies.qual を確認。

-- ============================================================
-- RLS 有効化（全テーブル）
-- ============================================================
alter table public.api_keys     enable row level security;
alter table public.projects     enable row level security;
alter table public.workflows    enable row level security;
alter table public.generations  enable row level security;
-- teams / team_members / usage_counters は 0001 で enable 済み（ポリシーも 0001 定義。本ファイルでは再掲しない）。

-- ============================================================
-- api_keys: 本人のみ全操作
-- ============================================================
drop policy if exists "Users can manage own api keys" on public.api_keys;
create policy "Users can manage own api keys" on public.api_keys
  for all to public using (auth.uid() = user_id);

-- ============================================================
-- projects: 本人のみ（SELECT/INSERT/UPDATE/DELETE）
-- ============================================================
drop policy if exists "Users can view own projects" on public.projects;
create policy "Users can view own projects" on public.projects
  for select to public using (auth.uid() = user_id);
drop policy if exists "Users can create own projects" on public.projects;
create policy "Users can create own projects" on public.projects
  for insert to public with check (auth.uid() = user_id);
drop policy if exists "Users can update own projects" on public.projects;
create policy "Users can update own projects" on public.projects
  for update to public using (auth.uid() = user_id);
drop policy if exists "Users can delete own projects" on public.projects;
create policy "Users can delete own projects" on public.projects
  for delete to public using (auth.uid() = user_id);

-- ============================================================
-- workflows: 自分のプロジェクト配下。SELECT は自分のもの OR is_public（コミュニティ）
-- ============================================================
drop policy if exists "Users can create workflows in own projects" on public.workflows;
create policy "Users can create workflows in own projects" on public.workflows
  for insert to public
  with check (project_id in (select projects.id from public.projects where projects.user_id = auth.uid()));
drop policy if exists "Users can update own workflows" on public.workflows;
create policy "Users can update own workflows" on public.workflows
  for update to public
  using (project_id in (select projects.id from public.projects where projects.user_id = auth.uid()));
drop policy if exists "Users can delete own workflows" on public.workflows;
create policy "Users can delete own workflows" on public.workflows
  for delete to public
  using (project_id in (select projects.id from public.projects where projects.user_id = auth.uid()));
drop policy if exists "Users can view own and public workflows" on public.workflows;
create policy "Users can view own and public workflows" on public.workflows
  for select to authenticated
  using ((is_public = true)
         or (project_id in (select projects.id from public.projects where projects.user_id = auth.uid())));

-- ============================================================
-- generations: 重複ポリシーあり（★ 統合候補）。DELETE ポリシーは意図的に無し
--   = クライアント削除不可。履歴削除はサーバー service role 経由（設計どおり正しい）。
--   VERIFY: workflow所有スコープの subquery は WHERE 句が画面外で、標準パターンで再構成。
-- ============================================================
drop policy if exists "Users can view own generations" on public.generations;
create policy "Users can view own generations" on public.generations
  for select to public
  using (workflow_id in (
    select w.id from public.workflows w join public.projects p on w.project_id = p.id
    where p.user_id = auth.uid()));            -- VERIFY
drop policy if exists "Users can view own generations by user_id" on public.generations;
create policy "Users can view own generations by user_id" on public.generations
  for select to public
  using (user_id = auth.uid());                -- ★ 上と重複（統合候補）
drop policy if exists "Users can create generations" on public.generations;
create policy "Users can create generations" on public.generations
  for insert to public
  with check (workflow_id in (
    select w.id from public.workflows w join public.projects p on w.project_id = p.id
    where p.user_id = auth.uid()));            -- VERIFY
drop policy if exists "Users can insert own generations" on public.generations;
create policy "Users can insert own generations" on public.generations
  for insert to public
  with check (user_id = auth.uid());           -- ★ 上と重複（統合候補）
drop policy if exists "Users can update own generations" on public.generations;
create policy "Users can update own generations" on public.generations
  for update to public
  using (workflow_id in (
    select w.id from public.workflows w join public.projects p on w.project_id = p.id
    where p.user_id = auth.uid()));            -- VERIFY

-- ============================================================
-- Storage（storage.objects）— 現状を「コメントで記録」（式が監査で部分的に画面外のため executable にしない）
-- ============================================================
-- バケット: generated-images / generated-videos とも public=true（★ バケット非公開化タスクで private 化予定）。
-- public のため SELECT(読取) ポリシーは無し（private 化時に追加要）。
--
-- INSERT/DELETE ポリシー（storage.objects）:
--   "Authenticated users can upload 1yhuiye_0"  INSERT authenticated
--       CHECK bucket_id='generated-images' AND (storage.foldername(name))[1] = auth.uid()::text
--       ★ 実パスは <nodeId>/... で uid フォルダではない → 画像は service role アップのため実質未使用・誤解を招く
--   "Authenticated users can upload 5k69g6_0"   INSERT authenticated
--       CHECK bucket_id='generated-videos'   （クライアント動画アップロード用）
--   "Users can delete own files 1yhuiye_0"      DELETE authenticated
--       USING bucket_id='generated-images' AND (storage.foldername(name))[1] = auth.uid()::text
--       ★ 同上（uid フォルダ・実質未使用）
--   "Users can delete own files 5k69g6_0"       DELETE authenticated
--       USING bucket_id='generated-videos' AND storage.extension(name) = 'jpg' AND ...
--       ★★ 誤設定（動画バケットに jpg 条件）= 死んだポリシー。cleanup で除去すべき。
--
-- ※ Storage の正確な式が必要になったら SQL Editor で:
--   select policyname, cmd, roles, qual, with_check from pg_policies
--   where schemaname='storage' and tablename='objects';
