# エンジニア引き継ぎ資料

> 最終更新: 2026-07-05。ソースコード・本番DBを直接確認して作成。
> この資料はリポジトリ内の正典。古い点を見つけたら**現物（コード/DB）を確認してここを更新**すること。

## 1. これは何か

Flora AI にインスパイアされた、ノードベースの AI 画像・動画生成ワークスペース。無限キャンバス上にノードを配置・接続して生成ワークフローを組む。**現在は複数支店を持つ企業向けの toB ピロット段階**（チーム管理・テナント分離・月次クォータまで実装済み・本番稼働中）。GA には法務文面確定とインフラ切替が残る（§13）。

## 2. 技術スタック

| カテゴリ | 技術 |
|---|---|
| Frontend | React 19 + TypeScript(strict) + Vite 8 |
| UI | Tailwind CSS v4 + 一部 shadcn/ui |
| Canvas | @xyflow/react 12.x (React Flow) |
| 状態管理 | Zustand + Zundo（Undo/Redo の temporal middleware） |
| Backend | Supabase（Auth / PostgreSQL + RLS / Storage） |
| AI API | fal.ai（画像・動画・LLM すべて統一。直接 Anthropic/OpenAI を叩かない） |
| Deploy | Vercel（静的 + Edge Functions） |
| テスト | Vitest（ユニット）＋ 統合スクリプト（§12） |
| 監視 | Sentry（`@sentry/vercel-edge` / `@sentry/react`・DSN 設定時のみ有効） |

## 3. ディレクトリ構成（要点）

```
api/                              # Vercel Edge Functions（本番）。`_`始まりは共有モジュール（関数化されない）
├── _sentry.ts                    # withSentry ラッパー（未捕捉例外を報告）
├── fal/proxy.ts                  # fal.ai プロキシ＋サーバー側クォータ強制
├── storage/
│   ├── sign-media.ts             # L2 署名エンドポイント（薄いラッパー）
│   ├── save-image.ts             # fal一時URL→自前バケット保存（薄いラッパー）
│   ├── delete-generation.ts      # 生成物削除（薄いラッパー）
│   └── _*Logic.ts                # ↑3本の共有コア。dev プロキシ(vite.config)と共用
├── team/
│   ├── manage.ts                 # チーム管理エンドポイント（薄いラッパー）
│   └── _teamLogic.ts             # チーム管理の共有コア（全 action の認可込み）
├── batch/                        # 撮影後工程の一括実行（仕様 docs/specs の撮影後工程 v4 §4）
│   ├── create/submit/reconcile/cancel/delete/retry/rerun/source.ts   # 認証必須の薄いラッパー（authedPost）。rerun = NG のみ再実行（設定差し替え）。source = 元ワークフローの列（閲覧）
│   ├── webhook.ts                # fal Webhook 受け口（公開。ジョブ秘密値＋Ed25519 署名＋request_id 所属で検証）
│   ├── _batchLogic.ts            # 共有コア。完了/失敗の反映は finalizeTask → RPC apply_batch_task_result の 1 経路
│   ├── _falWebhook.ts / _pricing.ts / _common.ts
└── cron/
    ├── cleanup-old-generations.ts   # 90日超の生成物を削除（日次）
    └── cleanup-orphan-storage.ts    # 孤児ストレージ回収（週次）

src/
├── components/{auth,canvas,capsule,home,jobs,layout,nodes,ui,legal}/   # jobs = ジョブ管理画面・投入ダイアログ
├── hooks/    useAuth, useAutoSave, useGenerationPolling, useIsMobile, useSignedMedia, useTheme, useToast
├── stores/   authStore, canvasStore, workflowStore, teamStore, batchStore（進行中ジョブ・Realtime・再開・照合）
├── lib/
│   ├── ai/    fal-client, fal-provider, fal-video-provider, provider-registry, kling-provider(@deprecated)
│   ├── api/   workflows, generations, projects, storage, teams, team, signMedia, batch（Edge 呼び出し）, batchJobs（RLS 読取・Realtime）
│   ├── batch/ items, upload, dates, cost, jobsQuery, realtimeGate（純関数。api/batch と共有するものあり）
│   ├── review/ ReviewGrid の中身: model（純関数）, renderCore（Worker/メインスレッド共通の描画）, renderWorker（module worker）, executor（LayoutExecutor: 実行者の差し替え口）, reviewStore（サムネイル計画・待ち行列・保存）, exportJob（ZIP 逐次書き込み）
│   ├── cutout/, layout/, export/   # 撮影後工程（切り抜き・レイアウト・書き出し）
│   └── supabase.ts
└── types/    nodes.ts, database.ts

middleware.ts                     # Basic認証（ベータ／保護環境のアクセス制御）
migrations/                       # 0001〜0012（下記§11）
tests/                            # 統合テスト（§12）。ユニットは src/**/*.test.ts
docs/specs/, docs/ops/            # PRD・運用ランブック
```

**型検査の範囲**: `tsconfig.node.json` の include は `vite.config.ts` と `api/**/*.ts`。Edge のエントリファイルも `npm run build`（`tsc -b`）で検査される（過去にエントリファイルが未検査で引数の数の誤りが本番に出たため）。

**dev/Edge の二重化解消（重要な構造）**: `sign-media` / `save-image` / `delete-generation` / `team-manage` は、Edge 関数（`api/`）と Vite dev ミドルウェア（`vite.config.ts` の `/dev-proxy/*`）の**両方が同一の共有コア `_*Logic.ts` を呼ぶ**。ロジックを変更するときは `_*Logic.ts` の1箇所だけ直せばよい（Edge/dev 両方に効く）。

## 4. 認証・アクセス制御

- **Supabase Auth**: Email/Password + Google OAuth（ポップアップ方式・`skipBrowserRedirect`）。
- **Basic認証**（`middleware.ts`）: 保護環境（ベータ等）のアクセス制御。`BASIC_AUTH_USER/PASS`。
- **全体の新規登録はブロック**（Supabase 側）。アカウント発行は2経路のみ:
  1. 運営が手動登録（ベータテスター等）。
  2. **invite-gated signup**: チームの招待リンク経由で、未アカウントの人がその場でアカウント作成→自動参加（§8）。
- **fal プロキシ**: Supabase JWT を検証してからサーバー側 `FAL_KEY` で転送（§6）。
- **sign-media / save-image / delete-generation / team-manage(list等)**: いずれも Edge 側で JWT 検証。例外は `team-manage` の `preview`/`signup`（未認証で可）と dev の `save-image`（クライアントが token を送らない設計のため dev のみ未認証）。

## 5. データモデル（本番実測 2026-07-05）

| テーブル | 主なカラム | 役割 |
|---|---|---|
| `projects` | id, user_id, name, description, thumbnail_url, created_at, updated_at | 1ユーザー≒1プロジェクト（初回自動作成） |
| `workflows` | id, project_id, name, canvas_data(JSONB), **visibility**, **team_id**, is_public(legacy), is_template, thumbnail_url, viewport, updated_at | キャンバス本体 |
| `generations` | id, workflow_id, node_id, user_id, **team_id**, node_type, status, output_url, input_params, output_metadata, provider, external_task_id, credits_used, error_message, completed_at, created_at | 生成履歴 |
| `teams` | id, name, **quota_image_monthly**, **quota_video_monthly**, created_at | テナント＝支店 |
| `team_members` | team_id, user_id(**unique**), role(owner/member), created_at | 所属（1ユーザー1チーム） |
| `team_invites` | id, team_id, token, created_by, expires_at, revoked_at, created_at | 共有招待リンク |
| `usage_counters` | team_id, user_id, period, kind, count（PK=4列） | 月次クォータ消費（§9） |

- `canvas_data` = `{ nodes, edges, viewport, capsuleGroupId }`。
- **workflows.visibility** = `private`(既定) / `team` / `public`。`is_public` は移行期の後方互換で残置（visibility が正典）。
- **RLS 全テーブル有効**。workflows SELECT = 所有者 OR public OR (team AND `is_team_member`)。generations も共有WF分は閲覧可。詳細は [migrations/0009_tenant_isolation.sql](../migrations/0009_tenant_isolation.sql)。

## 6. AI API アーキテクチャ

**すべての AI 呼び出しは fal.ai 経由**（`fal.subscribe`）。画像・動画・LLM（PromptEnhancer）とも同じ。

| 環境 | 接続 |
|---|---|
| ローカル | `/dev-proxy/fal`（vite dev ミドルウェア）経由。`.env.local` の `FAL_KEY` をサーバー側で使用（`VITE_FAL_KEY` は廃止） |
| 本番 | `/api/fal/proxy` 経由。Supabase JWT 検証 → サーバーの `FAL_KEY` で転送 |

両者は同一コア [api/fal/_proxyLogic.ts](../api/fal/_proxyLogic.ts)（allowlist・クォータ・転送）。呼び出せるモデルは [api/fal/_allowlist.ts](../api/fal/_allowlist.ts) で制限＝**モデル追加時は必ず更新**（ユニットテストが既存全モデルの許可を固定）。

設定は [src/lib/ai/fal-client.ts](../src/lib/ai/fal-client.ts) の `configureFal()` に一元化。

**現行モデル**（正典はコード）:
- 画像 [fal-provider.ts](../src/lib/ai/fal-provider.ts): Nano Banana 2 / Nano Banana Pro / FLUX.2 / FLUX Schnell / Dev / 1.1 Pro
- 動画 [fal-video-provider.ts](../src/lib/ai/fal-video-provider.ts): LTX-2.3 Fast/Pro（T2V・I2V）/ Kling v2.5-turbo Pro / Kling v3 Pro / Kling o3（I2V・V2V reference）
- LLM: `fal-ai/any-llm` + `anthropic/claude-haiku-4.5`（既定）/ `claude-sonnet-4.5`

## 7. テナント分離とメディア署名（L1 / L2）

- **L1**: `generated-images` / `generated-videos` バケットを**非公開化**。DB保存は canonical な `/object/public/...` 形式のまま、読込口で署名URLに変換。
- **L2**: 署名は **service role の `/api/storage/sign-media` のみ**が行う（クライアント直 `createSignedUrl` は 0009(B) で封鎖済み・本番実測で確認）。認可は「そのメディアが属する**ワークフローに呼び出し者がアクセスできるか**」で判定（所有者 / public / team）。
- クライアント側の要は [src/lib/api/storage.ts](../src/lib/api/storage.ts)（`toStoragePath`/`toCanonicalRef`/`signMediaRequest`）と [src/lib/api/signMedia.ts](../src/lib/api/signMedia.ts)、消費側 [src/hooks/useSignedMedia.ts](../src/hooks/useSignedMedia.ts)。
- **フィールド一覧は3箇所で lockstep**: `_signMediaLogic.ts` / `signMedia.ts` / `cron/cleanup-orphan-storage.ts`。メディアURLを持つノードフィールドを増やしたら3箇所とも更新。

## 8. チーム管理

設計正典: [docs/specs/team-management-mvp.md](specs/team-management-mvp.md)、運用: [docs/ops/pilot-team-setup.md](ops/pilot-team-setup.md)。

- **テナント = チーム = 支店**。**1ユーザー = 1チーム固定**（`team_members.user_id` unique）。toC 個人は「1人チーム」として同じ仕組みに乗る。
- **role**: owner（複数可）/ member。owner のみ 招待発行・メンバー削除・role変更・チーム名変更。最後の owner はガード（降格/離脱不可）。
- **招待**: owner が共有リンク発行（192bit token・7日期限・1チーム1アクティブ）。`/join/:token` で参加。
  - ログイン済み → opt-in 確認して参加。
  - 未ログイン → その場でアカウント作成（invite-gated signup）or ログイン。**人数上限 `MAX_TEAM_MEMBERS`（既定50・env可）＋直近1時間の登録数 `SIGNUP_MAX_PER_HOUR`（既定20・env可）でバースト抑制**。
- 離脱/削除 = 新しい個人チームへ移動（資産は user 所有なので保持）。**その際、本人が team 共有していた WF は private に戻す**（旧チームから不可視化＝クリーンな削除。`moveToNewPersonalTeam`・統合テスト Group D）。
- UI: [TeamPage.tsx](../src/components/home/TeamPage.tsx)（共有WF一覧＋作成者バッジ/フィルタ）、[TeamSettingsPage.tsx](../src/components/home/TeamSettingsPage.tsx)（メンバー一覧・使用状況バー・招待リンク・チーム名変更）、[JoinPage.tsx](../src/components/home/JoinPage.tsx)。
- 運用モデル: **運営は「支店チーム作成＋owner登録」だけ**行い、以降のメンバー追加は owner が招待リンクで自走。
- **運営コンソール `/admin`（Tier 1・運営専用）**: 支店チーム＋owner を1画面で作成＋全支店の一覧/消費。認可は `ADMIN_USER_IDS` allowlist（サーバーで 403・UI もナビ非表示）。コアは [api/admin/_adminLogic.ts](../api/admin/_adminLogic.ts)（Edge `api/admin/manage.ts` と vite dev `/dev-proxy/admin-manage` が共用）。破壊操作（削除/Ban）は未実装（安全側）。将来 Tier 2/3（横断ダッシュボード・監査ログ等）はこの上に積む。

## 9. クォータ（サーバー強制・チーム単位・月次）

> ⚠️ 旧資料の「generations の completed 件数で集計」は**廃止**。現行は下記。

- **消費先**: `usage_counters(team_id, user_id, period, kind, count)`。`period` = **JST の 'YYYY-MM'**（`currentPeriodJst`。`api/fal/proxy.ts` / `api/team/_teamLogic.ts` / `src/lib/api/teams.ts` の3箇所で一致させる／ユニットテスト有）。
- **強制点**: [api/fal/proxy.ts](../api/fal/proxy.ts) が生成 submit を検知したら、チーム合計消費（user行を SUM）を上限（`teams.quota_image_monthly`/`quota_video_monthly`・既定 画像100/動画7）と比較し、超過なら 429。通過後に `increment_usage_counter` RPC で +1。
- **課金対象の判定** `classifyGeneration`: 生成実行ホスト（`queue.fal.run/queue.fal.ai/fal.run/fal.ai`）への POST のみ。アップロード（rest/storage.*）・LLM（any-llm/llava）・poll（/requests/）は対象外。
- 失敗・キャンセルも消費（合意済み）。increment 失敗は生成を止めない（可用性優先）。

## 10. ノード

型定義は [src/types/nodes.ts](../src/types/nodes.ts) の `NodeType`。ユーザーが追加できるノードの正典は [FloatingToolbar.tsx](../src/components/layout/FloatingToolbar.tsx)。

- 主なユーザー追加ノード: TextPrompt / PromptEnhancer(LLM) / ImageGen（参照画像最大10枚）/ ReferenceImage / VideoGen（T2V/I2V/V2V）/ ReferenceVideo / List（バッチ）/ CameraList / Note。
- 自動生成（手動追加不可）: ImageDisplay / VideoDisplay（生成時に自動）/ Group（Cmd+G）。
- **StyleAnalysis ノードは仕様検討中の WIP で UI 非表示**（コードは存在するが未コミット WIP。§13）。
- `utility` / `text` / `image` / `video` は旧世代の type（現行は textPrompt/imageGen 等）。`kling-provider.ts` は @deprecated。
- **撮影後工程（2026-09）**: removeBackground / productLayout / batchInput / export。設計原則は仕様書 v4（商品ピクセル不変・マスクだけ保存・レイアウト計算は純関数・状態の正は DB）。
  - 対話実行はブラウザ主導（fal proxy 経由）。一括実行は `batchStore.openSubmitDialog` → `api/batch/create`（上限検査: 50 枚/ジョブ・日次 300 枚/チーム・同時 2 ジョブ）→ `submit`（元画像コピー→タスク作成→fal キュー投入、冪等・チャンク・attempts の CAS で二重投入防止）→ fal Webhook / `reconcile`（10 分超の投入済み）→ RPC で集約。
  - ジョブ管理画面 `/jobs`・`/jobs/:jobId`（`src/components/jobs/`）: RLS で直接読み、`batch_jobs` を Realtime 購読（チーム全体・ログイン中）、`batch_items` は詳細を開いている間だけ購読。アプリ起動時に `BatchSync` が「進行中の取得 → 自分の中断ジョブ（uploading・60 秒以上停止）の再開 → 照合 → 購読」を行う。Realtime に接続できない環境では見張り（realtimeGate）が諦めて再取得ポーリングに切り替える。
  - **ReviewGrid（Step 7）** `src/components/jobs/review/`: 写しの Product Layout ノード＝バリアント（`batch_jobs.layout_overrides` で上書き）。サムネイル（長辺 400px）は識別値 layoutHash（設定＋元画像＋結果ファイル＋版）で管理し、`batch_outputs(kind='thumb')` に記録・Storage に保存して再利用。描画は `LayoutExecutor`（Worker + OffscreenCanvas。無ければメインスレッド）で 1 アイテムずつ、Step 2/3 の関数をそのまま使う。書き出しは Worker でフル解像度→形式変換→fflate ストリーム ZIP。NG のみ再実行は `api/batch/rerun`（対象タスクを新設定で pending に戻し `input.__params` に保持、確認結果は未確認へ）。
  - **確認グリッド改訂（2026-10-03）**: 行×列の表から「列タブ＋カードグリッド」へ。`reviewStore` は `activeKey`（表示中の列）・`focusId`（キーボード位置）・`selected: Set<itemId>`（チェック）を持ち、OK / NG の UI は廃止（`batch_items.review` 列と `review_batch_item` RPC は残置・未使用）。再実行は「チェックした写真」を `api/batch/rerun` に渡す（`RerunDialog`）、書き出しは `ExportScope = 'selected' | 'all'`（`exportTargets(ctx, scope, selected)`）。矢印キーは `moveFocus(index, key, count, columns)`（列数は ReviewGrid が ResizeObserver で測って `onColumns`）。Jobs 一覧の「確認状況」列は削除（`fetchReviewCounts` は未使用のまま残置）。
  - **閲覧ルール（0016）**: ジョブが見えるのは作成者・チーム owner・元ワークフローが team/public のメンバー。Edge のジョブ操作（submit/cancel/retry/rerun/delete）と sign-media の `<team>/<job>/` パスも `can_view_batch_job_as(job, user)` で同じ判定（関数が無ければ所属のみ）。ジョブは見えるが元ワークフローが RLS で読めない人（チーム owner が他人の private ワークフローのジョブを開く）は `api/batch/source` で列（Product Layout / Remove Background / Batch Input ノードと接続）だけ読む＝`fetchJobWorkflowSource`（直接読み → Edge → 写し の順）。編集（レイアウト保存）は作成者だけ。一覧上部の枚数/進行中数は `team_batch_limits()`（チーム全体）。
  - **チーム編集と編集ロック（0017・フェーズ B）**: `workflows.team_edit`（所有者だけが変更。Header の表示範囲メニュー）。編集できる人 = 所有者 or（team_edit かつ team/public かつ同じチームの `team_members`）＝`can_edit_workflow(_as)`。workflows の UPDATE ポリシーはこの判定に置き換え、トリガ `workflows_shared_edit_guard` が「非所有者は中身（canvas_data / thumbnail）以外を変えられない」「team_edit のワークフローの canvas_data 変更には `workflow_edit_locks` の保持（90 秒以内の heartbeat）が必要（所有者も）」「updated_at はサーバー時刻・canvas_data が変われば `canvas_version` +1」を保証。ロックは RPC `acquire_workflow_edit_lock(wf, session, heartbeat)` / `release_workflow_edit_lock`（同じ人の別セッションは引き継ぐ。heartbeat は奪わない。失効したロックは誰でも引き継げる）。クライアント: `useEditLock`（所有者は自動取得、メンバーは「編集する」。20 秒 heartbeat・無操作 10 分/非表示 5 分で解放・pagehide で keepalive 解放・ロック行を Realtime 購読、閲覧中は 20 秒ごとに版を見て読み直し）、ストアは「所有（設定）」と「いま編集できるか」（`selectCanEditNow`）を分離、保存は `updateWorkflowCanvasChecked`（`canvas_version` の compare-and-set。衝突/ロック切れ/権限なしは `SaveBlockedDialog` で 読み直す・コピーとして保存・編集を再開）。`patchWorkflowNodeOutput` も版を確かめて書く（最大 3 回）。Jobs: 書き戻しは「ワークフローを編集できる人」（`layoutSaveTargetFor`）で、チーム編集のワークフローは書き戻しの間だけロックを取る。統合テスト Group G。
  - **Step 8 プロファイルと背景生成**: `src/lib/profile/profile.ts`（純関数）＝`buildProfile`（グラフ → JSON v1: input / cutout / backgrounds / variants / export。背景キーは生成器ノードの `params.backgroundKey` で往復保持）・`parseProfile`（format/version 検証・既定値補完・重複名の付け直し）・`planProfileImport`（開いているグラフにその場で当てる: Batch Input / Remove Background / Export は既存更新、Product Layout はバリアント名で更新・追加・削除、背景は同じモデル＋プロンプトの Image Generation を使い回し、無ければ Text Prompt + Image Generation（executionScope=job）を作って `in-image-background` へ接続、新規バリアントは Export の空きスロットへ）。入口は FloatingToolbar の Workflows「…」メニュー（現在のワークフローのみ。読み込みは `selectCanEditNow`）。サンプル `docs/profiles/sample-ec-sns.ppprofile.json`（往復テストあり）。
  - **フェーズ C(a) ステップ 1（サーバー・2026-10-03）: AI 処理 2 段までの連鎖**: `planTasks` は Batch Input の写真に行き着く Remove Background / Image Generation（編集・画像入力あり）を「段」付きで抽出（1 段目 = 写真を直接、2 段目 = 1 段目の結果。結果ノードは透過して生成器へ。3 段目は警告で対象外。`MAX_ITEM_STAGES`）。`PlannedTask` に `stage / dependsOn / label / dualOutput / kind('cutout'|'imageGen'|'imageEdit')`。編集の入力は `buildImageEditRequest`（`<model>/edit` or `openai/gpt-image-2/edit`、`image_urls` は投入時）。タスク行の input に `__stage/__depends_on/__dual/__label`（状態の種類は増やさない＝移行なし）。投入は `submitPendingTasks`（batch-submit・前段完了時 `submitDependents`（finalizeTask 内）・照合の末尾、の 3 経路で共通。`selectSubmittable` が ready/前段失敗/前段待ちに分け、前段失敗は RPC failed「前段の処理が失敗したため実行できません」= `propagateFailure`）。2 段目の入力画像: 生成→切り抜き は前段の result_path、切り抜き→生成 は `result_meta.cutout_path`（dual の切り抜きは fal 1 回で mask + 透過画像を受け取り `<node>-cutout.png` を保存。BiRefNet は `mask_only=false`、Bria は結果そのもの）。submit の `done` は「投入できるものが無い」（前段待ちは `waitingTasks`）。アイテムの ready は RPC が全タスク終了で判定（既存）。見積は `plan.breakdown`（ノード別 件数×単価）・`perItemGenerations`・`maxStage`。再実行（再度切り抜く）は段・依存・dual を保つ。受入: `npm run test:batch:chain`（③④を 2 枚で実測）。
  - **App モード中の二重描画（2026-10-04・ユーザー報告「App で投入すると Storage POST 400」）**: App モードでもキャンバスは背面で生きているため、キャンバスに置いた一括結果ノードと App の結果欄が同じジョブのサムネイルを同時に描いて保存し、後から上げた方が 400（Duplicate）になっていた。対処 = `BatchResultsNode` は `appMode !== 'graph'` の間はパネルを外して store を `close()`（見えないノードは描かない）。さらに `reviewStore` にタブ共有の `persistThumbOnce`（`persistedPaths` / `inFlightPaths`）を入れ、どの表示が同じパスを上げようとしても 1 回だけにした。
  - **App モード中のキャンバスの隠し方（2026-10-04・ユーザー報告の `<circle> cx: NaN` ×48）**: `/app/:id` は最初から App モードで開くため、デスクトップで `display:none` にしていたキャンバスが寸法 0 のまま React Flow を初期化し、Background の circle が NaN になっていた。モバイルと同じ `position:absolute; opacity:0; pointer-events:none; z-index:-1` で隠す方式に統一（`CanvasPage`）。隠れている間は選択を解除し、`deleteKeyCode` を無効化・`disableKeyboardA11y` にして、App 画面のキー操作が背面のノードに効かないようにした（`Canvas.tsx`）。
  - **保存の重複回避（2026-10-04・ユーザー報告の 400）**: `batch` バケットは insert/select だけで update を許していないため、識別値で名前が決まる出力（レイアウトの `<hash>.png`・サムネイル `thumb-…`）を同じ名前で上げ直すと Storage が 400（Duplicate）を返し、コードでは成功扱いでもコンソールに赤く残る。`uploadBatchObjectIfMissing`（`list` で有無を見てから upload。競合で先を越されても成功扱い）に置き換え、確認グリッドの store はこのインスタンスで保存した記録を `persisted` に覚えて描き直し自体を省く。Product Layout ノードは背景入力がつながっているのに画像がまだ無い（ジョブごとの生成器を Generate していない）場合、「接続されていない」警告の代わりに状況説明（Generate で反映・一括実行ではジョブごとに自動生成）を出す。
  - **フェーズ C(c) Apps ページ＋撮影後工程の App モード（2026-10-04）**: App の判定は `appKindOf(canvas)`（`src/lib/apps/appKind.ts`: Batch Input あり → 'batch'、capsuleEnabled のグループあり → 'generation'）。`/apps`（`AppsPage`: 自分の WF + `getTeamWorkflows()` を重複除去 → App だけ・種類フィルタ・撮影後工程はジョブ数 `fetchJobCountsByWorkflow`）。`/app/:workflowId` は `CanvasPage initialMode="app"`（マウント時に appMode 'capsule'）。CanvasPage の App 表示は `appKind === 'batch' ? <BatchAppView /> : <CapsuleView />`。`BatchAppView` = 左 `AppBatchInput`（写真はコンポーネント状態だけ・canvas_data に書かない・アップロード先 `interactive/<batchInputNodeId>/items/app-…`・投入完了後は key で作り直し）＋ 右 ジョブ選択 + `JobReviewPanel mode="app"`（node と同じくキャンバスの現在のノードが出どころ・キー操作は画面全体）。一括実行は `batchStore.openSubmitDialogWith({ items, snapshot, workflowId, onDone })` → `BatchSubmitDialog` がノード無しでも動き、完了後「結果を見る」で App の結果欄にそのジョブを出す。`useLiveCanvas()`（`src/hooks/`）を一括結果ノードと共用。Jobs ページは横断ビューのまま。
  - **フェーズ C(b) 一括結果ノード（2026-10-04）**: `BatchResultsNode`（RF type `batchResultsNode` / data.type `batchResults`・ポート無し・`NodeResizer` 既定 820×620）。確認グリッド一式は `JobReviewPanel`（`src/components/jobs/review/`）に切り出し、ジョブ管理画面（`JobDetailPage` = 薄い wrapper・mode 'page'）とノード（mode 'node'）で共用。node モード: バリアント/背景/Export 設定は `liveCanvas`（canvasStore の現在のノード。位置を除いた署名で 400ms デバウンス）から取り、レイアウト設定の引き出しは出さない（Product Layout ノードで変える）、キー操作はノード内フォーカス時のみ（`stopPropagation` で React Flow の矢印移動と衝突しない）、`nodrag nowheel` で中をスクロール。確認グリッドの状態は `createReviewStore()`（zustand vanilla）でインスタンス化（ジョブ管理 = 既定の `useReviewStore`、ノード = `createReviewStoreHook()` を useMemo で 1 つ・unmount で `close()` = Worker/objectURL 解放）。ジョブ一覧は `fetchWorkflowJobs(workflowId)`（RLS で見えるものだけ）。ノードがある間は `useWatchBatchJobs('results:<id>')` で Realtime を購読。App モードは未対応（(c)）。
  - **フェーズ C(a) ステップ 2（画面・2026-10-03）**: 列の種類が 3 つ（切り抜き・バリアント・**生成結果**）。生成結果の列は `resultColumnsOf(tasks, snapshot)`（item タスクの `input.__kind === 'imageEdit'` をノードごとに。名前 = `__label`、同名は (2)。キー `__result:<nodeId>`）。切り抜きノードの特定は `cutoutNodesFromSnapshot` → `itemAiStageOf`（サーバーの planTasks と同じ段の規則。Batch Input 直結でなくても 2 段以内なら対象）。`renderableOf` は item.status を見ず「切り抜きタスク完了（前段があればその結果も完了）」で描き、元画像は `sourcePath`（前段の result_path か写真）、識別値の `sourceRef` は `chainedSourceRef(dep)`（パス#版）。結果サムネイルは `executor.renderImageThumb`（Worker メッセージ `image` / `imageFull`。`renderCore.renderImageThumb/renderImageFull`）、識別値 `resultIdentityString`（結果パス + 版）、保存名 `thumb-result-<node>-<hash>`（batch_outputs.variant = 結果キー）。拡大の結果列は結果ファイルをそのまま返す。書き出しは `exportColumnsOf(variants, results, hasCutout)`（切り抜きが無いジョブはレイアウト列なし）＋ `exportTargets` が「描けるレイアウト or 完了した結果」の写真を返し、結果列は `renderImageFull` で Export の形式へ（フォルダ名 = ノード名・透過に JPEG 指定は PNG）。`BatchSubmitDialog` に `plan.breakdown` の内訳・`perItemGenerations` の注意（原価非表示でも必ず）・2 段の注記。キャンバス: `canvasStore.isCompatibleFor`（cutout → image は `imageGenerationNode` だけ。Canvas.tsx のドロップ接続も同じ規則）。Remove Background は後段に Image Generation があると `runCutoutInteractive({ dualOutput })` で透過画像も保存（`CutoutRef.cutoutPath` = `<ts>-cutout.png`。無ければノードに注意）。Image Generation は `resolveUpstreamCutoutUrls` で `cutoutPath` を署名して `image_urls` に使い（無ければ明示エラー）、参照スロットに切り抜きプレビューを出す。サーバー: 再度切り抜くと後段（`__depends_on` がそのノード）のタスクも未投入に戻す（`dependentTaskIds`）。スコープ: `planTasks` の写真ごと候補は Image Generation 全部（`executionScope` を見ない。写真由来の画像入力で段が付けば写真ごと、背景生成の候補からは除外して警告）。ノード側も `itemAiStageOf` で同じ判定をしてスコープの選択を固定（ユーザー報告: 背景用に「ジョブごと」だったノードに切り抜きをつないだら対象外になった件の修正）。切り抜きの同梱: `ExportParams.includeCutout`（既定 true・`normalizeExportParams`）。ジョブの書き出しは `exportColumnsOf(..., includeCutout)` が切り抜き列（`forcePng`・警告なし）を先頭に足し、`ExportDialog` は `summarize(params)` で列名・件数・概算を設定に追従させる。Export ノードは接続中の Product Layout の切り抜き入力をたどって Remove Background ごとに 1 件（`renderCutoutPngForExport` = マスク + 元画像からフル解像度 PNG）。既知の制約: 確認グリッドの切り抜き列は 1 ジョブ 1 ノード（`[0]`）。fal の編集応答に width/height が無いので結果列の枠比率は写真の比率にフォールバック。
    背景生成: `src/lib/batch/background.ts`（`resolveBackgroundSource`: 背景入力 → Image Generation 直結 / Image Display 経由 / 固定画像、`promptForGenerator`: 上流 Text Prompt の params.prompt ∥ outputText、`interactiveBackgroundUrl`）を ProductLayoutNode・`planTasks`・JobDetailPage で共用。`planTasks` はレイアウトの背景入力に行き着く executionScope='job' の生成器だけをジョブごとタスク 1 件にし、入力は `src/lib/ai/imageGenModels.ts` の `buildTextToImageInput`（Nano Banana=aspect_ratio+resolution / GPT-image, Recraft=image_size。ImageGenerationNode と定数を共有）。結果は `<team>/<job>/job/<node>-result.*`。JobDetailPage は生成器のジョブごとタスクの result_path（または写しに入れた固定画像の canonical URL）を sign-media で署名し `backgroundUrls[背景入力ノード id]` として確認グリッド/書き出しへ（サムネイル識別値に backgroundRef 入り）。写し（`buildWorkflowSnapshot`）は imageDisplay / referenceImage / image ノードの画像 URL（canonical）も持つ。統合テスト `WITH_BG=1 npm run test:batch` で背景 1 件を検証。
  - **バリアントの連動（0014）**: ジョブは元ワークフロー（見えるジョブのものは共有済みで RLS で読める）の `canvas_data` から Product Layout ノードを列にする（`fetchWorkflowFull`＝maybeSingle）（`variantsFromSnapshot` は写しと canvas_data の両形式を読む）。本人のワークフロー（`projects.user_id` = 自分。`fetchWorkflowFull` が `projects(user_id)` を埋め込み、他人のプロジェクト行は RLS で null → `layoutSaveTargetFor`）なら、書き戻し時に `fetchWorkflowFull` でワークフロー全体を取り直して差分を当て `canvas_data` に保存する（`addLayoutNodeToCanvas` 等の純関数 → `updateWorkflow`）。読めない/他人のものなら `layout_overrides`（ノード別上書き + `__added`）にジョブだけ保存。キャンバス側は `visibilitychange` で `updated_at` を見て、未保存の変更が無ければ読み直す（後勝ち）。AI 処理の設定・タスクは写しで固定のまま。

## 11. マイグレーション

`migrations/0001〜0010`。Claude は DDL 権限を持たず、**適用はユーザーが Supabase SQL Editor で行う**運用。要点:

| # | 内容 |
|---|---|
| 0001-0003 | teams/team_members/usage_counters スキーマ＋バックフィル＋`increment_usage_counter` |
| 0004-0007 | RLS スナップショット・storageポリシー整理・list関数・画像アップロードポリシー |
| 0008 | 生成バケット非公開化＋署名読取（L1） |
| 0009 | **テナント分離（L2）**: workflows.visibility/team_id・RLS拡張・`storage_keys_owned_by` RPC。(A)非破壊→(B)blanket SELECT drop の2段 |
| 0010 | チームメンバーシップ: team_invites・`team_members.user_id` unique・招待RLS |
| 0011 | 撮影後工程の基盤: teams に日次上限/原価表示・batch_jobs/items/tasks/outputs・集約RPC `apply_batch_task_result`・`review_batch_item`・私有バケット batch・Realtime publication |
| 0012 | 一括投入: タスク一意索引 (job,node,item) NULLS NOT DISTINCT・照合用索引・`batch_items.interactive_path`・RPC が pending→failed も許可 |
| 0013 | ReviewGrid: `batch_jobs.layout_overrides`＋RPC `set_batch_job_layout`・`batch_outputs.kind`（full/thumb）＋一意 (item,variant,hash,kind)・`record_batch_output` 5 引数版 |
| 0014 | ジョブと投入元ワークフローの連動: `batch_jobs.workflow_id`（投入時に本人 or チーム共有のワークフローだけ記録） |
| 0016 | ジョブの閲覧ルール: `can_view_batch_job(_as)`（作成者 / チーム owner / 共有ワークフローのメンバー）で batch_* の SELECT・storage の `<team>/<job>/` パス・`review_batch_item`・`record_batch_output` を判定。`set_batch_job_layout` は作成者のみ。`team_batch_limits()` でチーム全体の本日枚数/進行中数 |

## 12. テスト

詳細は [tests/README.md](../tests/README.md)。

- `npm test` — Vitest ユニット（`src/**/*.test.ts`・純関数のみ・秘密情報なし・CI可）。現状: メディアURL解析、クォータJST月境界。
- `npm run test:batch` — 撮影後工程の一括実行の受入（実 DB/実 Edge/実 fal。既定は本番=Webhook 経路、`APP_URL=http://localhost:5173` で dev=照合経路）。投入→完了→冪等→失敗分の再実行→NG のみ再実行（設定差し替え）→権限→同時ジョブ上限→削除まで。一時ユーザー/チームを作り finally で削除。fal のコストが数セントかかる。
- **本番テストの運用（2026-10-04・Disk IO 対策）**: 本番 DB は Micro（以前は Nano でスワップ常用→Disk IO 予算の通知）。受入テストは最小限に: `test:batch` は既定 5 枚（`ITEMS=20` は負荷確認時のみ）、`test:batch:chain` は連鎖のサーバー変更時のみ、`test:integration` はデプロイ 1 回につき 1 回。UI 確認の一時ジョブも最小限（作ったら必ず削除）。アプリ側は `batch_jobs` の Realtime 購読を「ジョブ管理画面を開いている間 or 進行中ジョブがある間」に限定（`batchStore.watch/unwatch`・`useWatchBatchJobs`・`shouldSubscribeJobs`）。
- `npm run test:integration` — 実DB/実Edge に対するセキュリティ回帰（L2クロステナント署名遮断・team/manage認可・sign-mediaクロステナント）。**一時データを作り finally で必ず削除**。生成APIは叩かない（コストなし）。リリース前チェック向け。

## 13. デプロイと環境

| 環境 | ブランチ | Supabase |
|---|---|---|
| 本番 | `main` | 本番DB |
| ステージング | `staging` | staging DB |
| ベータ | `beta` | staging DB 共用 |

- push → Vercel 自動デプロイ。**明示指示がない限りデプロイしない**。
- **未コミット WIP（StyleAnalysis 等）があるため、デプロイは worktree 方式**（`origin/main` から worktree を切り、対象ファイルだけコピー→ビルド→FF push→staging へマージ→ローカルは `git reset --mixed origin/main` で WIP を復元）。本体の作業ツリーに触れない。

**主要な環境変数**:

| 変数 | 用途 |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase（クライアント・Edge共用） |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバーのみ（署名・削除・クォータ・チーム管理） |
| `FAL_KEY` | fal.ai（サーバーのみ） |
| `FAL_KEY`（`.env.local`） | ローカル開発の dev proxy 用（`VITE_FAL_KEY` は廃止。フロントに鍵は乗らない） |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | 保護環境の Basic 認証 |
| `SENTRY_DSN` | エラー監視（任意） |
| `CRON_SECRET` | cron エンドポイント保護 |
| `MAX_TEAM_MEMBERS` / `SIGNUP_MAX_PER_HOUR` | 招待signupの上限・バースト抑制（任意・既定 50/20） |
| `ADMIN_USER_IDS` | 運営コンソール `/admin` の allowlist（運営 user_id のカンマ区切り）。未設定なら `/admin` は全員 403 |

> **秘密情報の運用**: service role/FAL_KEY/CRON_SECRET 等はユーザーが生成・設定する（Claude には貼らない）。ローカルの `.env.local` は本番DBを指すため、クロステナント否定テストは一時ユーザーで行い必ず削除する。

## 14. GA に向けた残タスク

- **法務文面の確定**（[TermsPage](../src/components/legal/TermsPage.tsx)/[PrivacyPage](../src/components/legal/PrivacyPage.tsx) の【】プレースホルダ8件＝運営者名・連絡先・料金・権利帰属・保存期間・賠償上限・管轄・更新日）→ 弁護士レビュー → ドラフトバナー削除。
- **invite-gated signup のメール所有証明**: 現状 `email_confirm:true` で発行しており、招待リンク＋人数/バースト上限のみが歯止め。GA では**メール確認フロー**（or owner 事前登録メール allowlist）が必要。
- **fal プロキシの per-IP レート制限**: 共有ストア（Upstash/Vercel KV）導入が前提。
- **GA 切替作業**: Vercel Pro 化・Basic認証の扱い・SignUp UI・メールテンプレート。
- WIP: StyleAnalysis ノードの仕様確定、動画 History URL 修正の最終確認。

## 15. 開発コマンド

```bash
npm run dev            # 開発サーバー（/dev-proxy/* が Edge を代替。本番DBを読む点に注意）
npm run build          # tsc -b && vite build
npm run lint           # eslint
npm test               # ユニットテスト
npm run test:integration  # 統合（実DB/Edge・一時データ自動削除）
npx tsc --noEmit       # 型チェックのみ
```
