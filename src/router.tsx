/* eslint-disable react-refresh/only-export-components -- route 設定ファイル。lazy() のページ定義と router export が同居するのは意図的（Fast Refresh 対象外） */
import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { HomeLayout } from './components/home/HomeLayout' // シェルは eager（即表示）

// ページは route 単位で遅延ロード（コード分割）。特に CanvasPage は React Flow を含むため
// /canvas を開くまで初期バンドルに載らない。named export を default に包んで lazy 化する。
const ProjectsPage = lazy(() => import('./components/home/ProjectsPage').then((m) => ({ default: m.ProjectsPage })))
const CommunityPage = lazy(() => import('./components/home/CommunityPage').then((m) => ({ default: m.CommunityPage })))
const TeamPage = lazy(() => import('./components/home/TeamPage').then((m) => ({ default: m.TeamPage })))
const TeamSettingsPage = lazy(() => import('./components/home/TeamSettingsPage').then((m) => ({ default: m.TeamSettingsPage })))
const JoinPage = lazy(() => import('./components/home/JoinPage').then((m) => ({ default: m.JoinPage })))
const HistoryPage = lazy(() => import('./components/home/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const MyPage = lazy(() => import('./components/home/MyPage').then((m) => ({ default: m.MyPage })))
const CanvasPage = lazy(() => import('./components/canvas/CanvasPage').then((m) => ({ default: m.CanvasPage })))
const TermsPage = lazy(() => import('./components/legal/TermsPage').then((m) => ({ default: m.TermsPage })))
const PrivacyPage = lazy(() => import('./components/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))
const AdminPage = lazy(() => import('./components/admin/AdminPage').then((m) => ({ default: m.AdminPage })))

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
