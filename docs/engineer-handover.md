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
└── cron/
    ├── cleanup-old-generations.ts   # 90日超の生成物を削除（日次）
    └── cleanup-orphan-storage.ts    # 孤児ストレージ回収（週次）

src/
├── components/{auth,canvas,capsule,home,layout,nodes,ui,legal}/
├── hooks/    useAuth, useAutoSave, useGenerationPolling, useIsMobile, useSignedMedia, useTheme, useToast
├── stores/   authStore, canvasStore, workflowStore, teamStore
├── lib/
│   ├── ai/    fal-client, fal-provider, fal-video-provider, provider-registry, kling-provider(@deprecated)
│   ├── api/   workflows, generations, projects, storage, teams, team, signMedia
│   └── supabase.ts
└── types/    nodes.ts, database.ts

middleware.ts                     # Basic認証（ベータ／保護環境のアクセス制御）
migrations/                       # 0001〜0010（下記§11）
tests/                            # 統合テスト（§12）。ユニットは src/**/*.test.ts
docs/specs/, docs/ops/            # PRD・運用ランブック
```

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
| ローカル | `VITE_FAL_KEY`（`.env.local`）で fal に直接 |
| 本番 | `/api/fal/proxy` 経由。Supabase JWT 検証 → サーバーの `FAL_KEY` で転送 |

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

## 11. マイグレーション

`migrations/0001〜0010`。Claude は DDL 権限を持たず、**適用はユーザーが Supabase SQL Editor で行う**運用。要点:

| # | 内容 |
|---|---|
| 0001-0003 | teams/team_members/usage_counters スキーマ＋バックフィル＋`increment_usage_counter` |
| 0004-0007 | RLS スナップショット・storageポリシー整理・list関数・画像アップロードポリシー |
| 0008 | 生成バケット非公開化＋署名読取（L1） |
| 0009 | **テナント分離（L2）**: workflows.visibility/team_id・RLS拡張・`storage_keys_owned_by` RPC。(A)非破壊→(B)blanket SELECT drop の2段 |
| 0010 | チームメンバーシップ: team_invites・`team_members.user_id` unique・招待RLS |

## 12. テスト

詳細は [tests/README.md](../tests/README.md)。

- `npm test` — Vitest ユニット（`src/**/*.test.ts`・純関数のみ・秘密情報なし・CI可）。現状: メディアURL解析、クォータJST月境界。
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
| `VITE_FAL_KEY` | ローカル開発専用（本番に設定しない） |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | 保護環境の Basic 認証 |
| `SENTRY_DSN` | エラー監視（任意） |
| `CRON_SECRET` | cron エンドポイント保護 |
| `MAX_TEAM_MEMBERS` / `SIGNUP_MAX_PER_HOUR` | 招待signupの上限・バースト抑制（任意・既定 50/20） |

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
