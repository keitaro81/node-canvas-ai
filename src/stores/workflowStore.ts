import { create } from 'zustand'
import { getProjects, createProject } from '../lib/api/projects'
import {
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  type WorkflowRow,
} from '../lib/api/workflows'
import { useCanvasStore } from './canvasStore'
import type { AppNode } from './canvasStore'
import type { Edge } from '@xyflow/react'
import type { Json } from '../types/database'

// ワークフロー保存に使う viewport 型
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

interface WorkflowState {
  currentWorkflowId: string | null
  currentWorkflowName: string
  workflows: WorkflowRow[]
  isSaving: boolean
  lastSavedAt: Date | null
  hasUnsavedChanges: boolean
  isLoadingWorkflow: boolean   // ロード中は autoSave をスキップするためのフラグ
  defaultProjectId: string | null

  loadWorkflows(): Promise<void>
  loadWorkflow(id: string): Promise<void>
  saveCurrentWorkflow(viewport?: CanvasViewport): Promise<void>
  createNewWorkflow(name?: string): Promise<void>
  renameWorkflow(id: string, name: string): Promise<void>
  deleteWorkflow(id: string): Promise<void>
  setCurrentWorkflowName(name: string): void
  markUnsavedChanges(): void
  initializeDefaultProject(): Promise<string>
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  currentWorkflowId: null,
  currentWorkflowName: 'Untitled Workflow',
  workflows: [],
  isSaving: false,
  lastSavedAt: null,
  hasUnsavedChanges: false,
  isLoadingWorkflow: false,
  defaultProjectId: null,

  async initializeDefaultProject(): Promise<string> {
    const cached = get().defaultProjectId
    if (cached) return cached

    const projects = await getProjects()
    if (projects.length > 0) {
      set({ defaultProjectId: projects[0].id })
      return projects[0].id
    }

    const newProject = await createProject({ name: 'My Project' })
    set({ defaultProjectId: newProject.id })
    return newProject.id
  },

  async loadWorkflows(): Promise<void> {
    const projectId = await get().initializeDefaultProject()
    const workflows = await getWorkflows(projectId)
    set({ workflows })
  },

  async loadWorkflow(id: string): Promise<void> {
    set({ isLoadingWorkflow: true })
    try {
      const workflow = await getWorkflow(id)
      const { setNodes, setEdges } = useCanvasStore.getState()
      const canvasData = workflow.canvas_data as { nodes?: AppNode[]; edges?: Edge[] } | null

      // 保存済みデータに blob: URL が残っていれば除去する
      // generating 状態のまま保存されたノードは error にリセット（リロード後に永遠に生成中にならないよう）
      const restoredNodes = (canvasData?.nodes ?? []).map((node) => {
        const d = node.data as Record<string, unknown>
        let data = d
        if (typeof d.uploadedImagePreview === 'string' && d.uploadedImagePreview.startsWith('blob:')) {
          const { uploadedImagePreview: _, ...rest } = d
          data = rest
        }
        if (data.status === 'generating') {
          data = { ...data, status: 'error', errorMessage: 'ページの再読み込みにより生成が中断されました' }
        }
        return { ...node, data }
      })
      setNodes(restoredNodes as AppNode[])
      setEdges(canvasData?.edges ?? [])

      set({
        currentWorkflowId: id,
        currentWorkflowName: workflow.name,
        hasUnsavedChanges: false,
        lastSavedAt: new Date(workflow.updated_at),
      })
    } finally {
      // ロード完了後に少し待ってからフラグを解除（canvasStore の変化通知を一周させる）
      setTimeout(() => set({ isLoadingWorkflow: false }), 100)
    }
  },

  async saveCurrentWorkflow(viewport?: CanvasViewport): Promise<void> {
    const { currentWorkflowId, isSaving } = get()
    if (!currentWorkflowId || isSaving) return

    set({ isSaving: true })
    try {
      const { nodes, edges } = useCanvasStore.getState()
      // blob: URL はセッション限りなので保存から除外する
      const sanitizedNodes = nodes.map((node) => {
        const d = node.data as Record<string, unknown>
        if (!d.uploadedImagePreview) return node
        const { uploadedImagePreview: _, ...rest } = d
        return { ...node, data: rest }
      })
      await updateWorkflow(currentWorkflowId, {
        canvas_data: { nodes: sanitizedNodes, edges, viewport: viewport ?? null } as unknown as Json,
      })
      set({ hasUnsavedChanges: false, lastSavedAt: new Date() })
    } finally {
      set({ isSaving: false })
    }
  },

  async createNewWorkflow(name = 'Untitled Workflow'): Promise<void> {
    const projectId = await get().initializeDefaultProject()
    const workflow = await createWorkflow({
      project_id: projectId,
      name,
      canvas_data: { nodes: [], edges: [], viewport: null },
    })

    useCanvasStore.getState().resetCanvas()
    set({
      currentWorkflowId: workflow.id,
      currentWorkflowName: workflow.name,
      hasUnsavedChanges: false,
      lastSavedAt: null,
    })
    await get().loadWorkflows()
  },

  async renameWorkflow(id: string, name: string): Promise<void> {
    await updateWorkflow(id, { name })
    if (get().currentWorkflowId === id) {
      set({ currentWorkflowName: name })
    }
    await get().loadWorkflows()
  },

  async deleteWorkflow(id: string): Promise<void> {
    await deleteWorkflow(id)
    const { currentWorkflowId } = get()
    await get().loadWorkflows()

    if (currentWorkflowId === id) {
      const remaining = get().workflows
      if (remaining.length > 0) {
        await get().loadWorkflow(remaining[0].id)
      } else {
        await get().createNewWorkflow()
      }
    }
  },

  setCurrentWorkflowName(name: string): void {
    set({ currentWorkflowName: name })
  },

  markUnsavedChanges(): void {
    set({ hasUnsavedChanges: true })
  },
}))
