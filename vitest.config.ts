import { defineConfig } from 'vitest/config'

// ユニットテスト専用設定（vite.config.ts の dev ミドルウェア/プラグインは読み込まない）。
// 対象は純関数のみ（ネットワーク・秘密情報なし）。統合テストは tests/integration/（別途 npm run test:integration）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    // supabase クライアント初期化用のダミー env（実接続はしない。canonical URL のアサートは host 非依存）。
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
