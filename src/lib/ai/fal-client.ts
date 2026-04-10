import { fal } from "@fal-ai/client";

/**
 * fal.ai クライアントを設定する。
 * - 開発環境 (VITE_FAL_KEY あり): APIキーで直接接続
 * - 本番環境: /api/fal/proxy 経由で接続（サーバーサイドで FAL_KEY を付与）
 */
export function configureFal(): void {
  const devKey = import.meta.env.VITE_FAL_KEY;
  if (devKey) {
    fal.config({ credentials: devKey });
    return;
  }
  fal.config({
    proxyUrl: "/api/fal/proxy",
  });
}

/** @deprecated configureFal() に統合済み */
export function initFalClient(): void {
  configureFal()
}

export { fal };
