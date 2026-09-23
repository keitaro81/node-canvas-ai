// 環境変数の値を整える（純関数）。
// Vercel の環境変数に末尾の改行が混ざると、ヘッダに入れる分は fetch が空白を落として通るが、
// URL に埋め込む Realtime の apikey は %0A 付きで送られて接続を拒否される（2026-09-23 本番で発生）。
export function cleanEnv(value: string | null | undefined): string {
  return (value ?? '').trim()
}
