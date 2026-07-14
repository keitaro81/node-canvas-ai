import { fal } from "@fal-ai/client";

let _token: string | null = null;

/**
 * fal.ai クライアントを設定する。
 * - 開発環境 (VITE_FAL_KEY あり): APIキーで直接接続
 * - 本番環境: /api/fal/proxy 経由で接続（Supabase JWT で認証）
 */
export function configureFal(supabaseToken: string | null): void {
  _token = supabaseToken;
  const devKey = import.meta.env.VITE_FAL_KEY;
  if (devKey) {
    fal.config({ credentials: devKey });
    return;
  }
  fal.config({
    proxyUrl: "/api/fal/proxy",
    credentials: () => _token ?? "",
    // proxy 経由では credentials に渡すのは Supabase JWT（プロキシ認証用）であり fal 鍵ではない。
    // SDK は「ブラウザに credentials がある」だけで警告するため、この分岐では誤警告になる → 抑制する。
    // （fal 鍵はサーバー側の /api/fal/proxy の FAL_KEY のみ。dev 分岐＝VITE_FAL_KEY 露出側の警告は残す）
    suppressLocalCredentialsWarning: true,
  });
}

/** @deprecated configureFal() に統合済み */
export function initFalClient(): void {
  // no-op
}

export { fal };
