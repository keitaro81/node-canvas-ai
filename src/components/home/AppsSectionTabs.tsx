// Apps セクションのタブ（App 一覧 / 履歴）。履歴（/jobs）はナビから外し、Apps ページのタブとして開く（2026-10-10 ユーザー決定）
import { Link } from 'react-router'

const TABS: Array<{ key: 'apps' | 'history'; to: string; label: string }> = [
  { key: 'apps', to: '/apps', label: 'App' },
  { key: 'history', to: '/jobs', label: '履歴' },
]

export function AppsSectionTabs({ active }: { active: 'apps' | 'history' }) {
  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Apps のセクション">
      {TABS.map((t) => {
        const on = t.key === active
        return (
          <Link
            key={t.key}
            to={t.to}
            role="tab"
            aria-selected={on}
            className="flex items-center h-8 px-3 rounded-lg text-[12px] font-medium transition-colors"
            style={{ background: on ? 'var(--text-primary)' : 'transparent', color: on ? 'var(--bg-surface)' : 'var(--text-secondary)', border: on ? '1px solid var(--text-primary)' : '1px solid var(--border)' }}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
