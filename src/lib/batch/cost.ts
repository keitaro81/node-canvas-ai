// コスト表示（仕様 4-7: 1 USD = 165 JPY。サーバー api/batch/_pricing.ts と共有）
export const USD_JPY = 165

/** "$0.024（約 4 円）" */
export function formatCost(usd: number | null | undefined): string {
  const v = typeof usd === 'number' && Number.isFinite(usd) ? usd : 0
  const jpy = Math.round(v * USD_JPY)
  return `$${v.toFixed(v < 0.01 && v > 0 ? 4 : 3)}（約 ${jpy.toLocaleString('ja-JP')} 円）`
}

/** 秒 → "約 1 分 30 秒" / "約 20 秒" */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `約 ${s} 秒`
  const m = Math.floor(s / 60), r = s % 60
  return r ? `約 ${m} 分 ${r} 秒` : `約 ${m} 分`
}
