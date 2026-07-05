# テスト

このリポジトリのテストは2層構成。

## ユニットテスト（`npm test`）

- Vitest。対象は `src/**/*.test.ts` の**純関数のみ**（ネットワーク・秘密情報なし・決定的）。
- CI やコミット前に安全に回せる。設定: [`vitest.config.ts`](../vitest.config.ts)。
- 現状のカバー:
  - `src/lib/api/storage.test.ts` — メディア URL 解析（`toStoragePath`/`toCanonicalRef`）。私有バケットの誤署名・公開URL取りこぼしの回帰防止（L1/L2 の要）。
  - `src/lib/api/period.test.ts` — クォータ月次キーの JST 月境界（`periodForJst`）。月境界で課金先の月がズレる回帰の防止。

```bash
npm test           # 一回実行
npm run test:watch # 監視モード
```

## 統合テスト（`npm run test:integration`）

- 実 DB・実 Edge に対する**再実行可能なセキュリティ回帰テスト**。[`tests/integration/run.mjs`](integration/run.mjs)。
- **⚠️ 対象 DB に一時ユーザー/チーム/WF を作成し、最後に必ず削除する**（`finally` で cleanup・残ゼロを表示）。
- 対象は `.env.local` の `VITE_SUPABASE_URL`（＝本番）。Edge のベースは `APP_URL` で上書き可（既定 `https://node-canvas-ai.vercel.app`）。**生成 API は叩かない（コストなし）**。
- 必要 env（`.env.local` から自動読込）: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`。
- カバー:
  - **Group A**: L2 ストレージ RLS カットオーバー — テナント外ユーザーは他人の私有オブジェクトを直接署名できない（対照: service role は署名可）。
  - **Group B**: `team/manage` 認可 — preview(未認証)200 / list 未認証 403 / 無効トークン 410 / signup メール形式 400。
  - **Group C**: `sign-media` クロステナント認可 — テナント外は他人の private WF を 403 / 所有者は 200 / 未認証 403。

```bash
npm run test:integration
```

> 統合テストは本番 DB を変更する（一時データの作成・削除）ため、CI の既定パイプラインには含めない。手動またはリリース前チェックで実行する。
