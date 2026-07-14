import { createBrowserRouter, Navigate } from 'react-router'
import { HomeLayout } from './components/home/HomeLayout'
import { ProjectsPage } from './components/home/ProjectsPage'
import { CommunityPage } from './components/home/CommunityPage'
import { TeamPage } from './components/home/TeamPage'
import { TeamSettingsPage } from './components/home/TeamSettingsPage'
import { JoinPage } from './components/home/JoinPage'
import { HistoryPage } from './components/home/HistoryPage'
import { MyPage } from './components/home/MyPage'
import { CanvasPage } from './components/canvas/CanvasPage'
import { TermsPage } from './components/legal/TermsPage'
import { PrivacyPage } from './components/legal/PrivacyPage'
import { AdminPage } from './components/admin/AdminPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/projects" replace />,
  },
  // 法務ページ: ログイン前でも閲覧可（AuthGuard が素通し）
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  {
    element: <HomeLayout />,
    children: [
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/team', element: <TeamPage /> },
      { path: '/team/settings', element: <TeamSettingsPage /> },
      { path: '/community', element: <CommunityPage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/account', element: <MyPage /> },
    ],
  },
  {
    path: '/canvas/:workflowId',
    element: <CanvasPage />,
  },
  // 運営コンソール（要ログイン＋サーバー側 ADMIN_USER_IDS ゲート。通常ナビには出さない）
  { path: '/admin', element: <AdminPage /> },
  // 招待リンクの着地（AuthGuard 配下＝未ログインはログイン後にここへ）
  { path: '/join/:token', element: <JoinPage /> },
])
