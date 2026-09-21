import { fal } from "@fal-ai/client";

let _token: string | null = null;

/**
 * fal.ai クライアントを設定する。**常に proxy 経由**（フロントは fal 鍵を持たない）。
 * - 開発: Vite dev ミドルウェア /dev-proxy/fal（サーバー側 FAL_KEY を .env.local から読む）
 * - 本番: /api/fal/proxy（Vercel Edge。Supabase JWT 検証後にサーバー側 FAL_KEY を使用）
 * credentials に渡すのは Supabase JWT（プロキシ認証用）であり fal 鍵ではない。
 */
export function configureFal(supabaseToken: string | null): void {
  _token = supabaseToken;
  fal.config({
    proxyUrl: import.meta.env.DEV ? "/dev-proxy/fal" : "/api/fal/proxy",
    credentials: () => _token ?? "",
    // SDK は「ブラウザに credentials がある」だけで警告するが、ここでの credentials は JWT なので抑制する
    suppressLocalCredentialsWarning: true,
  });
}

/** @deprecated configureFal() に統合済み */
export function initFalClient(): void {
  // no-op
}

export { fal };
