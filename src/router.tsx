import { createBrowserRouter, Navigate } from 'react-router'
import { HomeLayout } from './components/home/HomeLayout'
import { ProjectsPage } from './components/home/ProjectsPage'
import { CommunityPage } from './components/home/CommunityPage'
import { HistoryPage } from './components/home/HistoryPage'
import { CanvasPage } from './components/canvas/CanvasPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/projects" replace />,
  },
  {
    element: <HomeLayout />,
    children: [
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/community', element: <CommunityPage /> },
      { path: '/history', element: <HistoryPage /> },
    ],
  },
  {
    path: '/canvas/:workflowId',
    element: <CanvasPage />,
  },
])
