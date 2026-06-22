import { createBrowserRouter, Navigate } from 'react-router'
import { HomeLayout } from './components/home/HomeLayout'
import { ProjectsPage } from './components/home/ProjectsPage'
import { CommunityPage } from './components/home/CommunityPage'
import { TeamPage } from './components/home/TeamPage'
import { HistoryPage } from './components/home/HistoryPage'
import { MyPage } from './components/home/MyPage'
import { CanvasPage } from './components/canvas/CanvasPage'
import { TermsPage } from './components/legal/TermsPage'
import { PrivacyPage } from './components/legal/PrivacyPage'

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
      { path: '/community', element: <CommunityPage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/account', element: <MyPage /> },
    ],
  },
  {
    path: '/canvas/:workflowId',
    element: <CanvasPage />,
  },
])
