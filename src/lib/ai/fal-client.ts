import { fal } from "@fal-ai/client";

/**
 * fal.ai クライアントを設定する。
 * - 開発環境 (VITE_FAL_KEY あり): APIキーで直接接続
 * - 本番環境: /api/fal/proxy 経由で接続（Supabase JWT で認証）
 */
export function configureFal(supabaseToken: string | null): void {
  const devKey = import.meta.env.VITE_FAL_KEY;
  if (devKey) {
    fal.config({ credentials: devKey });
    return;
  }
  fal.config({
    proxyUrl: "/api/fal/proxy",
    credentials: supabaseToken ?? "",
  });
}

/** @deprecated authStore の初期化で configureFal が呼ばれるため不要 */
export function initFalClient(): void {
  // no-op: authStore.initialize() → configureFal() で設定済み
}

export { fal };
