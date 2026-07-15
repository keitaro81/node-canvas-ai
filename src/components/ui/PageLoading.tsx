import { CircleNotch } from '@phosphor-icons/react'

// route の遅延ロード中に表示する共通フォールバック（コード分割の Suspense fallback）。
export function PageLoading() {
  return (
    <div className="flex items-center justify-center h-full w-full min-h-[200px]">
      <CircleNotch size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
    </div>
  )
}
