-- 0014: ジョブと元ワークフローの連動（撮影後工程 Step 7 追加）— batch_jobs.workflow_id
--
-- 設計: バリアント（Product Layout ノード）はワークフローを唯一の正とし、ジョブは投入元ワークフローの現在のノードから列を作る。
-- AI 処理（切り抜きの設定・タスク）は従来どおり写し（workflow_snapshot）で固定。
-- 前提: 0011〜0013 適用済み。冪等・非破壊。ロールアウト: staging → 本番。

begin;

alter table public.batch_jobs add column if not exists workflow_id uuid references public.workflows(id) on delete set null;
create index if not exists batch_jobs_workflow_idx on public.batch_jobs(workflow_id);

commit;

-- 検証: select column_name from information_schema.columns where table_name='batch_jobs' and column_name='workflow_id';  -- 1行
