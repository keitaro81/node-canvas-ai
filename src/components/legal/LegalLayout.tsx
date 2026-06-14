import type { ReactNode } from 'react'

/**
 * 法務ページ（利用規約・プライバシーポリシー）の共通レイアウト。
 * ログイン前でも閲覧できるよう、AuthGuard が /terms・/privacy を素通しする（AuthGuard.tsx 参照）。
 */
export function LegalLayout({ title, lastUpdated, children }: { title: string; lastUpdated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <div className="max-w-3xl mx-auto px-6 py-10">
        <a href="/" className="text-[13px] transition-colors" style={{ color: 'var(--text-tertiary)' }}>
          ← Node Canvas AI
        </a>
        <h1 className="text-[24px] font-semibold mt-4 mb-1">{title}</h1>
        <p className="text-[12px] mb-6" style={{ color: 'var(--text-tertiary)' }}>最終更新日: {lastUpdated}</p>

        {/* ドラフト警告（公開前に削除する想定） */}
        <div
          className="rounded-lg px-4 py-3 mb-8 text-[12px] leading-[1.7]"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B' }}
        >
          ⚠️ これは雛形（ドラフト）です。公開前に必ず弁護士・専門家のレビューを受け、【 】箇所を確定し、本注意書きを削除してください。
        </div>

        <div className="flex flex-col gap-7 text-[14px] leading-[1.9]" style={{ color: 'var(--text-secondary)' }}>
          {children}
        </div>

        <div className="mt-12 pt-6 border-t text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
          <a href="/terms" className="mr-4">利用規約</a>
          <a href="/privacy" className="mr-4">プライバシーポリシー</a>
        </div>
      </div>
    </div>
  )
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{heading}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}
