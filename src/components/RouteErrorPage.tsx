// ルートのエラー画面（React Router の errorElement）。
// デプロイ直後に古い画面のまま遷移して「古いチャンクが無い」ときは一度だけ自動で再読み込みし、それ以外は日本語の案内と再読み込みボタンを出す（2026-11-08 メモ 74）
import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { isStaleChunkError, reloadIfStaleChunk } from '../lib/staleChunk'

export function RouteErrorPage() {
  const error = useRouteError()
  const stale = isStaleChunkError(error)
  // 古いチャンクのエラーなら一度だけ自動で再読み込み（30 秒以内に再読み込み済みなら何もしない → 下のボタンで手動）
  useEffect(() => { if (stale) reloadIfStaleChunk(error) }, [stale, error])

  const notFound = isRouteErrorResponse(error) && error.status === 404
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error ?? '')
  const title = stale ? 'アプリが更新されました' : notFound ? 'ページが見つかりません' : '画面を表示できませんでした'
  const body = stale ? '新しい版が公開されたため、開いていた画面が古くなりました。自動で読み込み直します。切り替わらないときは「再読み込み」を押してください'
    : notFound ? 'アドレスが間違っているか、ページが移動しました'
    : '予期しないエラーが起きました。再読み込みで直ることが多いです。続くときはこの文をお知らせください'

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg-canvas, #0A0A0B)', color: 'var(--text-primary, #FAFAFA)', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="w-full max-w-[440px] rounded-xl p-6 flex flex-col gap-3" style={{ background: 'var(--bg-surface, #111113)', border: '1px solid var(--border, #27272A)' }}>
        <h1 className="text-[16px] font-semibold">{title}</h1>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary, #A1A1AA)' }}>{body}</p>
        {(
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => window.location.reload()} className="h-9 px-4 rounded-lg text-[13px] font-medium text-white" style={{ background: '#8B5CF6' }}>再読み込み</button>
            <a href="/projects" className="h-9 px-4 rounded-lg text-[13px] font-medium flex items-center" style={{ border: '1px solid var(--border-active, #3F3F46)', color: 'var(--text-primary, #FAFAFA)' }}>ホームへ</a>
          </div>
        )}
        {!stale && message && (
          <pre className="text-[11px] whitespace-pre-wrap break-all rounded-md p-2 mt-1" style={{ background: 'var(--bg-canvas, #0A0A0B)', color: 'var(--text-tertiary, #71717A)' }}>{message}</pre>
        )}
      </div>
    </div>
  )
}
