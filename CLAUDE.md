# Node Canvas AI

## プロジェクト概要
Flora AIにインスパイアされた、ノードベースのAI画像・動画生成ワークスペース。
無限キャンバス上にノードを配置・接続してAI生成ワークフローを構築する。

## 技術スタック
- Frontend: React 18 + TypeScript + Vite
- UI: Tailwind CSS + shadcn/ui
- Canvas: React Flow (@xyflow/react)
- State: Zustand
- Backend: Supabase
- AI API: fal.ai（画像・動画・LLM すべて統一）
- Deploy: Vercel（API Routes = Edge Functions）

## コマンド
- 開発サーバー起動: `npm run dev`
- ビルド: `npm run build`
- リント: `npm run lint`
- 型チェック: `npx tsc --noEmit`

## AI API アーキテクチャ（重要）

### すべての AI 呼び出しは fal.ai 経由
画像・動画・LLM（PromptEnhancer 等）を問わず、**Anthropic / OpenAI / Google 等の API を直接 fetch してはいけない**。
必ず `fal.subscribe()` を使う。fal.ai が各プロバイダへのプロキシを担う。

```ts
// 画像生成
fal.subscribe('fal-ai/nano-banana-2', { input: { prompt, ... } })

// 動画生成
fal.subscribe('fal-ai/ltx-2.3/text-to-video/fast', { input: { ... } })

// LLM（PromptEnhancer）
fal.subscribe('fal-ai/any-llm', { input: { model: 'anthropic/claude-haiku-4.5', prompt, system_prompt } })
```

### 認証・プロキシ構成
| 環境 | 接続方式 |
|------|---------|
| ローカル開発 | `VITE_FAL_KEY`（`.env.local`）で fal に直接接続 |
| 本番（Vercel） | `/api/fal/proxy`（Vercel Edge Function）経由。Supabase JWT で認証後、サーバー側の `FAL_KEY` を使用 |

- `VITE_FAL_KEY` はブラウザに露出するが開発専用。本番では設定しない。
- `FAL_KEY`（非 VITE_）はサーバー側のみ。クライアントには漏れない。
- fal クライアントの設定は `src/lib/ai/fal-client.ts` の `configureFal()` で一元管理。

### fal-ai/any-llm の有効なモデルID（2026年4月時点）
- `anthropic/claude-haiku-4.5`
- `anthropic/claude-sonnet-4.5`
- `anthropic/claude-3.7-sonnet`
- `google/gemini-2.5-pro`
- `openai/gpt-4o` など

### デプロイ
- 明示的に「デプロイして」と言われない限り、本番・ステージング・ベータへのデプロイは行わない。

## コーディング規約
- 言語: TypeScript（strict mode）
- スタイル: Tailwind CSS のユーティリティクラスを使用
- コンポーネント: 関数コンポーネント + hooks
- 状態管理: Zustand ストア（src/stores/）
- 命名: PascalCase（コンポーネント）、camelCase（関数・変数）
- ファイル配置:
  - src/components/canvas/ — キャンバス関連
  - src/components/nodes/ — カスタムノード
  - src/components/panels/ — サイドバー・プロパティパネル
  - src/components/ui/ — shadcn/ui コンポーネント
  - src/hooks/ — カスタムフック
  - src/stores/ — Zustand ストア
  - src/types/ — TypeScript 型定義
  - src/lib/ — ユーティリティ

## デザイン方針 — Flora AI スタイル準拠

### 全体の世界観
- Flora AI のクリーンでプロフェッショナルなダークUIを踏襲
- "クリエイティブツール" としての洗練された印象
- Figma/Miro のような無限キャンバスの操作感
- 情報密度は高いが、視覚的にはミニマル

### カラーシステム

#### ベースカラー（キャンバス・背景）
- canvas-bg: #0A0A0B（ほぼ黒に近いダークグレー — Flora準拠）
- canvas-dots: #1A1A1E（グリッドドット — 非常に控えめ）
- surface-primary: #111113（ノードカード背景 — わずかに明るい）
- surface-secondary: #18181B（サイドバー・パネル背景）
- surface-elevated: #1E1E22（ホバー・選択状態の背景）
- border-default: #27272A（ボーダー — 非常に控えめ）
- border-active: #3F3F46（アクティブ状態のボーダー）

#### テキストカラー
- text-primary: #FAFAFA（メインテキスト — ほぼ白）
- text-secondary: #A1A1AA（サブテキスト・ラベル）
- text-tertiary: #71717A（プレースホルダー・非活性）

#### ノードタイプ別アクセントカラー（Flora AI準拠）
- node-text: #6366F1（インディゴ — テキスト系ノード）
- node-image: #8B5CF6（パープル — 画像系ノード）
- node-video: #EC4899（ピンク — 動画系ノード）
- node-utility: #6B7280（グレー — ユーティリティノード）
- accent-primary: #8B5CF6（メインアクセント — ボタン等）
- accent-success: #22C55E（生成完了）
- accent-warning: #F59E0B（警告）
- accent-error: #EF4444（エラー）

#### 接続線（エッジ）カラー
- edge-text: #6366F1（テキストデータの流れ）
- edge-image: #8B5CF6（画像データの流れ）
- edge-video: #EC4899（動画データの流れ）
- edge-inactive: #3F3F46（未接続・非活性）

### タイポグラフィ
- フォントファミリー: "Inter", system-ui, -apple-system, sans-serif
- フォントウェイト:
  - ノードタイトル: 600（Semi Bold）
  - ラベル: 500（Medium）
  - 本文: 400（Regular）
  - 補助テキスト: 400 + text-secondary色
- フォントサイズ:
  - ヘッダーロゴ: 16px
  - ノードタイトル: 13px
  - ラベル・入力: 12px
  - 補助テキスト: 11px
- 行間: 1.5

### ノードデザイン（Flora AI スタイル）
- 角丸: 12px（ノードカード全体）
- ボーダー: 1px solid border-default（通常時）
- ボーダー（選択時）: 1px solid accent-primary + 微かなグロー
- 背景: surface-primary
- 影: なし（フラットデザイン — Flora準拠）
- ヘッダー:
  - 高さ: 36px
  - 左端にノードタイプ別カラーの縦バー（幅3px, 角丸上部のみ）
  - アイコン（16px）+ タイトル
  - 右端に「...」メニューアイコン（ホバー時のみ表示）
- ポート（Handle）:
  - サイズ: 10px の円
  - 入力: ノード左端の中央
  - 出力: ノード右端の中央
  - 色: データタイプに対応（text=インディゴ, image=パープル）
  - ホバー時: 12pxに拡大 + グロー効果
- ノード幅: 280px（デフォルト）— 一部ノードはリサイズ可能
- パディング: 12px

### キャンバス
- 背景: canvas-bg のべた塗り + canvas-dots のドットグリッド
- ドットグリッド:
  - ドットサイズ: 1px
  - ドット間隔: 20px
  - 非常に控えめ（ほとんど見えないレベル）
- ズーム時にドット間隔がスケール
- ノード追加: ダブルクリック or 右クリックメニュー（Flora準拠）

### 接続線（エッジ）
- スタイル: ベジェ曲線（smoothstep ではなく bezier）
- 線幅: 2px
- 色: データタイプに対応
- データフロー時: 流れるアニメーション（dashOffset アニメーション）
- ホバー時: 線幅 3px + グロー

### サイドバー・パネル
- 背景: surface-secondary
- 右端/左端にborder-defaultの1pxボーダー
- パネルヘッダー: text-secondary色のラベル + 控えめなアイコン
- 折りたたみ: スムーズなスライドアニメーション（200ms ease-out）
- パネル内のセクション区切り: 1px border-default のライン

### ボタン
- プライマリ（生成ボタン等）:
  - 背景: accent-primary
  - テキスト: white
  - 角丸: 8px
  - ホバー: 明るさ +10%
  - 高さ: 36px
- セカンダリ:
  - 背景: transparent
  - ボーダー: 1px solid border-active
  - テキスト: text-primary
  - ホバー: surface-elevated 背景
- ゴースト（アイコンボタン）:
  - 背景: transparent
  - ホバー: surface-elevated 背景
  - サイズ: 28px x 28px

### 入力フィールド
- 背景: #0A0A0B（キャンバスと同じ、沈み込んだ印象）
- ボーダー: 1px solid border-default
- フォーカス時: border-active + 微かなグロー
- 角丸: 6px
- パディング: 8px 10px
- テキストエリア（プロンプト入力）:
  - 最小高さ: 80px
  - リサイズ: 縦方向のみ

### ドロップダウン・セレクト
- Flora スタイルのコンパクトなドロップダウン
- 背景: surface-primary
- 選択中の項目: surface-elevated 背景
- 各項目: 32px 高さ

### コンテキストメニュー（右クリック）
- 背景: surface-secondary
- ボーダー: 1px solid border-default
- 角丸: 8px
- 影: 0 4px 16px rgba(0,0,0,0.4)
- 各項目: 32px 高さ, ホバーで surface-elevated

### アニメーション・トランジション
- すべてのUI要素: 150ms ease-out
- パネル開閉: 200ms ease-out
- ノード追加時: scale 0.9 → 1.0 のポップイン（150ms）
- 生成中のノード: ボーダーがaccent-primaryで緩やかにパルス（2秒周期）
- 接続線のデータフロー: dashOffset アニメーション（1秒周期）

### レスポンシブ
- 最小画面幅: 1024px（それ以下は非対応でOK）
- サイドバーは画面幅 1280px 以下で自動折りたたみ

### Interフォントの導入
- Google Fonts から Inter を読み込む
- index.html の <head> に追加:
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
- tailwind.config で fontFamily.sans の先頭に 'Inter' を追加
