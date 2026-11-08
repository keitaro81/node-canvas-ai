# 商品動画のノード分解 — 設計案

**作成:** 2026-10-31（方針 2「既存の語彙に分解する」をユーザーが選択）
**状態:** 承認済み（2026-10-31・§13 の 3 点も決定）。フェーズ A デプロイ済み（00834a9）・フェーズ B デプロイ済み（c4b9183）・フェーズ C 実装（2026-10-31）

---

## 1. 背景と目的

Product Video ノードは入出力ポートを持たず、テンプレート・ショット列・共通の説明を持つ「設定カード」で、実行はサーバーが
ショット ×N（Kling v3 Pro）→ 結合（ffmpeg）を固定手順で回す。ワークフローの種類（商品動画 App）もこのノードの有無で決まる。
撮影後工程で確立した原則「キャンバスが一括処理の配線そのもので、App はその顔」の例外になっており、

- キャンバス上で何もつながらない・ノード単体では何も試せない（プロンプト調整は毎回ジョブ＝コストと日次上限）
- 固定手順がサーバーと App にだけ存在し、ショット単位のやり直し・一括での動画生成・結果の列表示が独自実装になる

という問題がある。本設計は、商品動画の手順を既存の語彙（入力ノード → 生成ノード → 結合 → 書き出し）に分解し、
App の見え方は変えずに、キャンバスで組める・試せる・やり直せる形にする。

## 2. ゴール / 非ゴール

ゴール
- 商品動画のワークフローを **Cut Set Input → Video Generation ×N → Video Merge →（Export）** で表す
- Video Generation を一括実行の「写真（SKU）ごとに動くノード」にする（Batch Input からの動画生成もこれで動く）
- 結果の見せ方・ライブラリ・ダウンロード・日次上限・費用の見積は今と同じ体験を保つ
- 既存の商品動画ワークフロー・既存ジョブは壊さない（自動展開・id 互換）
- ノードが組み済みの **テンプレートから新規作成**（ユーザー要望・2026-10-31）

非ゴール（今回やらない）
- サブグラフ（複合ノードの展開表示）
- 画像の列（Product Layout）と動画を 1 つのジョブ画面に同居させる統合ビュー（§12 の割り切り）
- 参照動画が要るモデル（video-to-video / reference-to-video）の一括実行（アイテムごとの参照動画が無い）

## 3. 現状の要点（コードの事実）

| 項目 | 現状 |
|---|---|
| Product Video ノード | ポート無し。`params = { templateId, shots[{role,endRole?,duration,motion}], basePrompt, negativePrompt }` |
| App 種別 | `appKindOf`: productVideo があれば 'video'、batchInput があれば 'batch' |
| 投入 | App の `AppVideoCutsInput`（SKU カード・役割別の枠）→ `batch_items.cuts`（0018）・`kind='video'`（0019） |
| 計画 | `planTasks` の専用分岐: ショット `videoShot`（node_id `<pv>:shot:<i>`・stage 1）＋ 結合 `videoMerge`（node_id `<pv>`・stage 2・全ショット待ち） |
| 入力の組み立て | `buildTaskInput`: 役割のカットを `start_image_url`、終了カットを `end_image_url`、正面＋別角度（優先順 最大 3）を `elements` |
| 省略 | 役割のカットが無いショットは作らない。作るショットが 1 本なら結合せずコピー |
| 結果 | `VideoReviewPanel`: `videoNodeOf(snapshot)` の id のタスク＝結合、`:shot:` 付き＝ショット |
| ライブラリ | `listBatchVideos`: kind='video' のジョブの `:shot:` を含まない完了タスク |
| Video Generation ノード | 入力 `in-text` / `in-image`（開始）/ `in-image-end`（終了）/ `in-image-cuts`（参照カット）/ `in-video`、出力 `out-video`。elements・multi_prompt 対応。インラインのプロンプト欄は無い |
| 接続 | どの入力ハンドルも 1 接続（`canvasStore` が同じハンドルへの既存接続を除去）。参照カットの「複数接続」は実際には 1 本しか残らない |

## 4. 新しい形

```
Cut Set Input ─ 正面 ──→ Video Generation A（正面 → 右側面・3 秒）─┐
              ─ 右側面 ─→ Video Generation B（右側面 → 背面・3 秒）─┼─ Video Merge ─→ Export
              ─ 背面 ──→ Video Generation C（背面 → 左側面・3 秒）─┤        │
              ─ 左側面 ─→ Video Generation D（左側面 → 正面・3 秒）─┘   Video Result
              ─ カット一式 ──→（A〜D の参照カット）
Text Prompt（共通の説明）──→（A〜D のプロンプト）
```

### 4.1 Cut Set Input ノード（新規・`cutSetInput`）

- 1 アイテム = 1 SKU。役割（正面 / 右側面 / 左側面 / 背面 / ディテール / 全身）ごとに 1 枚。最大 50 SKU。
- 出力ポート: `out-image-front` `out-image-right` `out-image-left` `out-image-back` `out-image-detail` `out-image-full`（型 image）、
  `out-cuts-set`（型 cuts＝カット一式。参照カット用）、`out-item-item`（型 item。SKU・連番。Export の命名用）
- ノード本体: SKU カード（SKU 名・役割の枠・★・削除）。Batch Input と同じく「一括実行…（n 件）」ボタンを持つ。
  枠は App と同じ共通コンポーネント（`CutSetCards`）で、アップロード先も同じ `interactive/<nodeId>/items/`。
- 対話実行（★ の 1 SKU）: 役割ポートはその SKU のカットの署名 URL、カット一式はカットの集合、アイテム情報は SKU を出す。
  ポートごとの出力は `data.outputs[handleId]` に持ち、受け側は辺の `sourceHandle` で引く（`getImageUrlFromNodeData` に sourceHandle を渡せるようにする。既存ノードは `data.output` のまま）。
- 役割ポートは普通の画像なので、Cut Set Input → Remove Background → Product Layout（正面カットの切り抜き）のような使い方もそのまま成立する。

### 4.2 Video Generation ノードの拡張（`videoGen`）

- 新しい入力 `in-cuts-set`（型 cuts）: つなぐと elements = 正面 ＋ 別角度（右側面・左側面・背面・全身・ディテールの優先順で最大 3）。
  `in-image` が無ければ正面を開始フレームにする（今の `elementCutsOf` と同じ）。既存の `in-image-cuts` は `in-cuts-set` に置き換える（1 接続しか残らないため実質同じ）。
- インラインの欄を足す: **動き（プロンプト・日本語可）**、**避けたいこと（ネガティブ・Kling 系のみ）**。`in-text` につないだテキストは共通の説明として先頭に付く（複数は改行で連結＝今の挙動）。
- **回転指示の自動生成**（`autoTurn`・既定 on）: 開始と終了の両方が Cut Set Input の役割ポートから来ているとき、辺の `sourceHandle` から役割を読み、
  `turnInstruction(role, endRole)` の文と negative、`cfg_scale 0.7` を付ける（`productVideo.ts` の既存ロジックを移す）。ノードの見出しに「正面 → 右側面・3 秒」と出す。
- elements があるときは `@Element1 wearing the garment.` を自動で挟む（今の `shotPrompt` と同じ）。
- 一括実行の対象かをノードに表示する（「一括実行: 対象」/「対象外: 参照動画が要るモデルは未対応」/「Batch Input / Cut Set Input に接続されていません」）。
- 対話実行でも日本語の文は生成前に英訳する（fal `any-llm` をプロキシ経由で。組み込み文は対訳表、英語はそのまま。サーバーの `_translate.ts` と同じ規則を共有モジュールにする）。
- 既存機能（モデル選択・マルチショット・参照動画・count）はそのまま。一括実行では count は 1 固定。

### 4.3 Video Merge ノード（新規・`videoMerge`）

- 入力 `in-video-1 … in-video-8`（接続数 + 1 の空き枠。順序 = 結合順）、出力 `out-video`。
- 対話実行: 「結合」ボタン → `fal-ai/ffmpeg-api/merge-videos`（プロキシ経由）→ ノード内で再生・ダウンロード・`out-video` に出す。
  つながっている動画が 1 本なら fal を呼ばずそのまま通す（サーバーの「1 本ならコピー」と同じ）。
- 一括実行: タスク種別 `videoMerge`（既存）。待つ前段 = スロット順の Video Generation。

### 4.4 Export の動画対応

- 画像スロットの下に動画スロット `in-video-1 … in-video-8` を足す。対話実行の ZIP に mp4 をそのまま（再エンコード無し）命名規則で入れる。
- 一括実行: 結果欄の「すべてダウンロード」が Export の命名規則を使う（Export が無ければ今までどおり `<SKU>.mp4`）。形式・品質の設定は動画には適用しない。

### 4.5 ポート型と互換

- `PortType` に `cuts` を追加（色 #F472B6）。互換: cuts → cuts のみ（Cut Set Input → Video Generation）。
- 役割ポート（image）は既存の画像入力すべてに接続できる。`cutout` → image は従来どおり Image Generation だけ。
- Export の動画スロットは video のみ。

### 4.6 対話実行（キャンバスで試す）

Cut Set Input に 1 SKU 入れて ★、各 Video Generation の「Generate」→ Video Result、Video Merge の「結合」で 1 本。
ジョブを作らずにプロンプトと構成を確かめられる（費用は Kling の秒数分だけ。日次上限は一括実行のジョブ単位なので消費しない。今のキャンバスの動画生成と同じ扱い）。

## 5. 一括実行（サーバー）の計画ルール

計画は純関数を `src/lib/batch/plan.ts` に移し、サーバー（`api/batch/_batchLogic.ts`）と画面（App の構成表示・結果欄の判定）が同じ関数を使う。
写しに Product Video ノードがあれば、計画の前に §7 の展開を通す（専用分岐は廃止し、計画は 1 本にする）。

### 5.1 ノードの種類と段

| ノード | 種別 | スコープ | 段の数え方 |
|---|---|---|---|
| Remove Background | cutout | アイテム | AI 段 |
| Image Generation（画像入力あり） | imageEdit | アイテム | AI 段 |
| Image Generation（背景・画像入力なし・job） | imageGen | ジョブ | 1 回 |
| Video Generation | videoShot | アイテム | AI 段 |
| Video Merge | videoMerge | アイテム | 段には数えない（結合は AI 処理ではない） |

- 入力の出どころ: Batch Input（写真・アイテム情報）、Cut Set Input（役割ポート・カット一式・アイテム情報）、AI ノード（前段の結果。Image Display 経由は透過）。
- 1 経路の AI 段は 2 まで（`MAX_ITEM_STAGES`）。Video Merge は数えないので Remove Background → Video Generation → Video Merge は成立する。3 段目の AI ノードは今までどおり注意を出して対象外。
- **動画があるジョブは動画だけを作る（2026-10-31 決定）**: 動画タスクが 1 つでもある写しでは、動画タスクにつながらない画像のタスク（Product Layout にしか行かない切り抜き・動画に使わない画像生成）を対象外にし、
  注意「この構成では Product Layout / 画像の結果は作りません（動画だけを処理します）」を出す。動画の前段として使う切り抜き・画像生成は動く。画像も欲しければ画像用のワークフローを別に作る。
- Video Generation の一括対象条件: 開始フレーム（`in-image`）かカット一式（`in-cuts-set`）が入力ノード/AI ノードに行き着く・モデルが画像 → 動画に対応（§5.5）・プロンプトが空でない（つないだテキスト or 動きの欄 or 自動回転指示）。

### 5.2 入力の解決（タスクの `input.__inputs`）

タスクごとに「何を入力にするか」を参照の表で持ち、投入時（`buildTaskInput`）はこの表だけを見る。

| 参照 | 意味 | 解決 |
|---|---|---|
| `{ kind: 'photo' }` | Batch Input の写真 | `item.source_path` |
| `{ kind: 'cut', role }` | Cut Set Input の役割カット | `item.cuts[role].path` |
| `{ kind: 'set' }` | カット一式 | 正面 + 優先順の別角度（最大 3）→ `elements` |
| `{ kind: 'dep', nodeId, prefer }` | 前段の結果 | `prefer: 'cutout'` なら `result_meta.cutout_path`、それ以外は `result_path` |

- cutout / imageEdit: `{ image }`。videoShot: `{ start?, end?, elements? }`。videoMerge: `{ videos: [nodeId…] }`（スロット順）。
- `__depends_on` は参照に出てくる前段ノード id の配列（既存の複数待ちの仕組みをそのまま使う）。
- 切り抜きを Video Generation の開始フレームに使う場合は、その切り抜きを `dualOutput`（透過画像も保存）にする（切り抜き → 生成と同じ扱い）。

### 5.3 SKU ごとの省略と結合

- アイテムごとのタスクは、参照がすべて揃うときだけ作る（役割のカットが無い・一式に正面が無い → そのタスクは作らない）。今の「役割のカットが無いショットは飛ばす」と同じ。
- Video Merge は、その SKU で作られた前段のタスクだけを待つ。1 本なら結合せずコピー（既存の `completeMergeByCopy`）、0 本なら作らない。
- 件数の見積（`countOf`）も同じ規則で数える（ショット = カットが揃う SKU 数、結合 = 1 本以上ある SKU 数）。

### 5.4 終端ノード・結果の見せ方・ライブラリ

- 動画タスクのうち、`out-video` の先に計画対象の動画ノード（Video Merge）が無いものを **終端** とし、`input.__terminal = true` を付ける。
- 結果欄（`VideoReviewPanel`）: 1 SKU = 終端タスクの動画（複数あれば並べる）。「カット n」で前段（依存をたどった Video Generation）のタスクを見せる（ラベルは `__label`）。
  ジョブ画面・一括結果ノード・App・履歴で共通（今と同じ）。動画タスクが 1 つでもあるジョブは結果欄を動画にする（写しの判定から、タスクの種別の判定に変える）。
- ライブラリ・「動画を追加」: `listBatchVideos` は `__terminal` のタスクを拾う（古いタスクは `:shot:` 無し＝終端の従来判定で後方互換）。
- 旧ジョブ（結合 = `<pv>` id、ショット = `<pv>:shot:<i>`）は §7 の id 互換でそのまま表示できる。

### 5.5 件数・上限・費用・翻訳

- `batch_jobs.kind`: 動画タスクが 1 つでもあれば 'video'（本・SKU 数で数える・`daily_video_limit`）、無ければ 'cutout'。列・RPC は変更なし。
- 一括実行で使える動画モデルは **画像 → 動画に対応する全モデル**（Kling v3 Pro / Kling 2.5 Turbo / Kling o3 Pro / Seedance 2.0 / LTX-2.3 の image-to-video。2026-10-31 ユーザー決定）。
  参照動画が要るモデル（video-to-video / reference-to-video）は対象外の注意。elements・終了フレーム・negative は対応するモデルだけに送る（対応表 `VIDEO_MODELS` の features / endImageParam に従う）。
  fal への入力はクライアントの `buildInput` から純関数部分（`src/lib/ai/videoRequest.ts`）を切り出してサーバーと共有する。比率 'auto' はブラウザでは画像を読んで決めているので、サーバーではアイテム（写真・カット）の幅と高さから最近傍を選ぶ。
  プロキシの allowlist に無いエンドポイント（`bytedance/seedance-2.0`）は追加する。
- 費用: `_pricing.ts` に各モデルの秒単価（`VIDEO_MODELS.pricePerSecond` と同じ値）を登録する（Kling v3 = 秒 × $0.10、結合 $0）。確認ダイアログの内訳はノード名ごとに「n 件」（今の「ショット n 本・結合 n 件」は種別の集計として維持）。
- 翻訳: ジョブ作成時に、計画対象の Video Generation の「動き」「避けたいこと」と、それにつないだ Text Prompt の日本語を集めて `promptTranslations` に入れる（既存の仕組み。組み込み文は対訳表）。

### 5.6 やり直し（ショット単位・第 2 弾）

- `batchRerunItems` を Video Generation ノードにも対応させる: 指定 SKU のそのショットのタスクと、その先の Video Merge を未投入へ戻す（設定は写しのまま）。
- 結果欄の「カット n」の各ショットに「このショットをやり直す」。やり直した分の費用は実績に加算（日次上限の本数は同じジョブなので増えない＝切り抜きのやり直しと同じ扱い）。
- 設定を変えてのやり直し（プロンプト差し替え）は後続。

## 6. App の見え方

変わらないこと
- 左の「カットを入れる」（SKU カード・始点│→│終点の枠・補足カット・モデルから入れる・ブラウザへの記憶）、「n 件を処理する」→ 確認 → 裏で処理、右の「結果」、ダウンロード、失敗分のやり直し、日次上限（本）、費用の目安。

変わること
- `appKindOf`: Cut Set Input（または旧 Product Video）があれば 'video'。Batch Input → Video Generation の構成は 'batch'（写真の投入画面）のまま、結果欄だけ動画になる。
- 枠の構成（どの役割を始点・終点にするか・秒数・順序）は、ノードの設定ではなくキャンバスから導く（`shotsFromCanvas`: Cut Set Input につながる Video Generation ごとに始点/終点の役割・秒数、順序は Video Merge のスロット順）。`AppVideoCutsInput` の入力は今までどおり `VideoShotSpec[]`。
- 旧ノードが残っている保存済みワークフローは、読み込み時にメモリ上で展開して同じ画面を出す（§7）。

## 7. 旧 Product Video ノードの移行

- 展開関数 `expandProductVideo(canvas)`（純関数・決定的な id）:
  - Cut Set Input `<pv>:cuts`、Text Prompt `<pv>:base`（共通の説明）、Video Generation `<pv>:shot:<i>`（秒数・動き・避けたいこと・終了カットがあれば autoTurn・モデル Kling v3 Pro・音声なし）、Video Merge `<pv>`
  - 辺: 役割ポート → 各ショットの開始/終了、カット一式 → 各ショットの参照カット、共通の説明 → 各ショットの `in-text`、ショット i → Merge のスロット i+1
  - 配置: 元のノードの右に縦に並べる
- 展開を通す場所: ワークフロー読み込み（キャンバスに載せる前）、計画（写しに旧ノードがあるとき）、App 種別・構成の判定。保存されるのは所有者が開いて保存したときだけ。
- id を揃えるので、既存ジョブのタスク（`<pv>:shot:<i>` / `<pv>`）は新しい結果欄・ライブラリ・やり直しでそのまま扱える。テンプレート名付き（templateId）の旧ノードは展開時点の定義で展開する（以後はノードの編集が正）。
- `productVideo` 型は読み取り用に残し、パレット（右クリック・ツールバー）からは外す。新規作成はテンプレート（§8）から。

## 8. テンプレート（ノードが組み済みの新規作成）

- `src/lib/templates/` にテンプレート定義（名前・説明・アイコン・キャンバス生成関数）。商品動画の 3 構成（EC 標準 15 秒 / ターンテーブル 12 秒 / ショート 9 秒）を §7 の展開関数で生成する（旧ノードのプリセットの置き場がここになる）。
- **2026-11-08 更新**: ユーザーの試行で「正面＋背面の 2 枚を Kling Element に渡し、Video Generation 1 本（10 秒・始点も終点も正面）で一回転」の方が 4 本結合より良かったため、商品動画のテンプレートはこの 1 本版だけにした（EC 15 秒・ショート 9 秒・4 本結合・試着 → ターンテーブルは一旦外す）。
- 入口: My Projects の「テンプレートから作成」→ 一覧ダイアログ → 既定プロジェクトに新しいワークフローを作って開く（`createWorkflow` の既存経路）。
- 後続: 任意のワークフローを「テンプレートとして保存」（チーム共有）。今回は組み込みのみ。

## 9. データ / DB

- DDL なし。`batch_items.cuts`（0018）、`batch_jobs.kind`・`teams.daily_video_limit`（0019）をそのまま使う。
- 写し（`workflow_snapshot`）: Cut Set Input の `items` は Batch Input と同様に id・SKU・パスだけ持つ。
- タスク `input`: `__inputs`（§5.2）・`__terminal`（§5.4）を追加（既存キー `__kind` `__stage` `__depends_on` `__dual` `__label` は維持。`__shot` は展開後は `__inputs` に吸収。読み取りは後方互換）。

## 10. 変更するファイル（概略）

| 領域 | ファイル | 変更 |
|---|---|---|
| 計画（共有） | `src/lib/batch/plan.ts`（新規）、`api/batch/_batchLogic.ts` | 計画・展開・終端判定・`shotsFromCanvas` を純関数へ。サーバーは呼ぶだけ。`buildTaskInput` を参照表方式に |
| 動画の入力 | `src/lib/ai/videoRequest.ts`（新規）、`src/lib/ai/fal-video-provider.ts` | fal 入力の組み立てを純関数に切り出し、サーバーと共有 |
| 翻訳 | `src/lib/video/translate.ts`（新規）、`api/batch/_translate.ts` | 規則・system prompt を共有。クライアントはプロキシ経由で any-llm |
| 型 | `src/types/nodes.ts`、`src/types/batch.ts` | `cutSetInput` `videoMerge` 型・`cuts` ポート・VG の欄 |
| ノード | `CutSetInputNode.tsx`（新規）、`VideoMergeNode.tsx`（新規）、`VideoGenerationNode.tsx`、`ExportNode.tsx` | §4 |
| 共通 UI | `src/components/app/CutSetCards.tsx`（`AppVideoCutsInput` から切り出し） | ノードと App で共用 |
| キャンバス | `canvasStore.ts`（互換表・ポートごとの出力）、`Canvas.tsx`、`ContextMenu.tsx`、`FloatingToolbar.tsx` | 新ノード・パレット（「商品動画」カテゴリ）・旧ノードの削除 |
| App | `appKind.ts`、`VideoAppView.tsx`、`VideoReviewPanel.tsx`、`JobReviewPanel.tsx` | §6・§5.4 |
| ライブラリ | `batchVideos.ts` | 終端タスク |
| 読み込み | `workflowStore.ts`（`loadWorkflow`）、`src/lib/batch/migrate.ts`（新規） | §7 の展開 |
| テンプレート | `src/lib/templates/`（新規）、`ProjectsPage.tsx` | §8 |
| サーバー | `batchCreate`（kind・検証・翻訳の収集）、`batchRerunItems`（動画ノード） | §5.5・§5.6 |
| 文書 | `docs/member-guide.md`、`docs/engineer-handover.md` | 各フェーズで更新 |

## 11. 段階と受け入れ

各フェーズが 1 回のデプロイ。フェーズ A の時点でも既存の商品動画 App はそのまま動く（旧ノードは計画時に展開）。

**フェーズ A — 計画の一本化と動画ノードの一括対応（サーバー中心）**
- `plan.ts` へ移設・参照表方式・終端フラグ・旧ノードの展開（計画時のみ）・Video Merge ノード・Video Generation の一括対応（Kling v3 Pro）・結果欄とライブラリの終端判定
- 受け入れ: 単体テスト（旧 3 テンプレートの展開が今の計画と同じ node_id / endpoint / 入力になる、段・省略・結合順・終端）、`npm run test:batch`、`npm run test:integration`、
  既存の商品動画 App で 1 SKU の実行（ユーザー・本番）、Batch Input → Video Generation → Video Merge の実行

**フェーズ B — Cut Set Input と Video Generation の拡張、App と移行**
- Cut Set Input ノード・`cuts` ポート・VG の欄（動き / 避けたいこと / 自動回転 / 対象表示 / 対話実行の翻訳）・読み込み時の展開・`shotsFromCanvas`・パレットから Product Video を外す
- 受け入れ: 単体テスト（`shotsFromCanvas`・展開の決定性）、`npm run test:integration`、旧ワークフローを開いて同じ App 画面になる、新しい配線をキャンバスで対話実行 → 一括実行（ユーザー・本番）

**フェーズ C — テンプレート・Export の動画・ショット単位のやり直し**
- 受け入れ: テンプレートから作成 → そのまま一括実行、Export の ZIP 命名、ショットのやり直し（`npm run test:integration`、ユーザー・本番）

## 12. 制約・割り切り

- 一括実行の動画モデルは画像 → 動画に対応するもの（参照動画が要るモデルは対象外の注意）。
- 画像の列（Product Layout など）と動画が同じジョブにある場合、動画につながらない画像の枝は実行しない（§5.1・費用もかからない）。結果欄は動画。結果の画面を 1 つに統合する案（列 = ノードをグリッドに広げる）は分解が終わったあとのフェーズ D として別途検討。
- 一括実行では Video Generation の count は 1。マルチショット（multi_prompt）は 1 ノード内の機能としてそのまま（一括でも送る）。
- 5 ショットの構成は Video Generation が 5 つ並ぶ。テンプレートで組み済みのものを配ることで作る手間を抑える。
- 保存済みワークフローの旧ノードは所有者が保存するまで DB 上は旧ノードのまま（読み込み・計画はどちらでも同じ結果）。

## 13. 決めてほしいこと

1. ~~一括実行の動画モデル~~ → **決定（2026-10-31）: 画像 → 動画に対応する全モデルを対象にする。**
2. ~~テンプレートの入口~~ → **決定（2026-10-31）: My Projects の「テンプレートから作成」だけ。**
3. ~~画像の列と動画の同居~~ → **決定（2026-10-31）: 動画があるジョブでは、動画につながらない画像の枝を対象外にする（注意を出す）。統合ビューはフェーズ D 候補。**
