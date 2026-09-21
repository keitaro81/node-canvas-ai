// fal.ai 呼び出しの許可リスト（ホスト＋モデルパスのプレフィックス）。
// /api/fal/proxy（Edge）と vite dev の /dev-proxy/fal が共用する（仕様書 §4-5 fal-run「許可リストで制限」）。
// ⚠️ モデルを追加/変更したら必ずここも更新すること（漏れると本番で 400 "Target not allowed"）。
//    同期元: src/lib/ai/fal-provider.ts / fal-video-provider.ts / PromptEnhancerNode / StyleAnalysisNode / ImageGenerationNode(edit)

export const ALLOWED_FAL_HOSTS = ['fal.run', 'queue.fal.run', 'rest.fal.run', 'storage.fal.run', 'rest.fal.ai', 'queue.fal.ai', 'fal.ai']

// 生成を実行しない補助ホスト（アップロード/状態取得）。パス制限なし。
const UTILITY_HOSTS = new Set(['rest.fal.run', 'storage.fal.run', 'rest.fal.ai'])

// 撮影後工程: 背景切り抜きエンジン候補（Step 2 で比較・確定。月次画像クォータとは別建て＝課金分類から除外）
export const BG_REMOVAL_PREFIXES = ['fal-ai/bria/background/remove', 'fal-ai/birefnet']

// 呼び出しを許可するモデルパスのプレフィックス。`<prefix>` 完全一致 or `<prefix>/...`（/edit・/requests/<id> 等を含む）
export const ALLOWED_MODEL_PREFIXES = [
  // 画像生成
  'fal-ai/nano-banana-2',
  'fal-ai/nano-banana-pro',
  'fal-ai/flux-2',
  'black-forest-labs/flux-schnell',
  'black-forest-labs/flux-dev',
  'black-forest-labs/flux-1.1-pro',
  'fal-ai/recraft/v4',
  'openai/gpt-image-2',
  // 動画生成
  'fal-ai/ltx-2.3',
  'fal-ai/kling-video',
  // LLM / 画像解析
  'fal-ai/any-llm',
  'fal-ai/llava-next',
  // 撮影後工程
  ...BG_REMOVAL_PREFIXES,
]

/** URL のパスからモデルパス（先頭の / を除いたもの）を返す。 */
export function modelPathOf(url: URL): string {
  return url.pathname.replace(/^\/+/, '')
}

function matchesPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((pre) => path === pre || path.startsWith(pre + '/'))
}

/** 転送を許可する対象か（ホスト allowlist ＋ 生成ホストではモデルパス allowlist）。 */
export function isAllowedTarget(url: URL): boolean {
  if (!ALLOWED_FAL_HOSTS.includes(url.hostname)) return false
  if (UTILITY_HOSTS.has(url.hostname)) return true
  return matchesPrefix(modelPathOf(url), ALLOWED_MODEL_PREFIXES)
}

/** 背景切り抜きエンジンへの呼び出しか（月次画像クォータの課金対象から除外する判定に使う）。 */
export function isBgRemovalPath(path: string): boolean {
  return matchesPrefix(path, BG_REMOVAL_PREFIXES)
}
