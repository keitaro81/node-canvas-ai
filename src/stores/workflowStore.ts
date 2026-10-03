import { create } from 'zustand'
import { showToast } from '../hooks/useToast'
import { getProjects, createProject } from '../lib/api/projects'
import { deleteGenerationsByWorkflow } from '../lib/api/generations'
import {
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  updateWorkflowThumbnail,
  toggleWorkflowPublic,
  setWorkflowVisibility,
  setWorkflowTeamEdit,
  canEditWorkflow,
  updateWorkflowCanvasChecked,
  type WorkflowVisibility,
  type WorkflowRow,
} from '../lib/api/workflows'
import { onCanvasVersion } from '../lib/workflow/canvasVersion'
import { FREE_LOCK, classifySaveError, editSessionId, lockRequiredFor, type EditLockView } from '../lib/workflow/editLock'
import { canonicalizeCanvasNodes, signCanvasNodes } from '../lib/api/signMedia'
import { useCanvasStore, loadCanvasState } from './canvasStore'
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
  currentWorkflowIsPublic: boolean
  currentWorkflowVisibility: WorkflowVisibility
  currentWorkflowIsOwned: boolean  // 自分のプロジェクト配下かどうか（共有設定・名前・削除は所有者だけ）
  currentWorkflowTeamEdit: boolean // 「チームの編集を許可」（0017）
  currentWorkflowCanEdit: boolean  // 編集権: 所有者 or 許可された同じチームのメンバー
  currentWorkflowCanvasVersion: number // 読み込んだ/保存した canvas_data の版（保存の衝突確認）
  editing: boolean                 // このタブが編集モード（ロックが要るワークフローではロック保持中）
  editLock: EditLockView           // 編集ロックの表示状態（誰が編集中か）
  editSessionId: string            // タブ単位の識別子
  saveBlocked: SaveBlocked | null  // 保存できなかった理由（衝突・ロック切れ・権限）→ ダイアログで選んでもらう
  editEnded: EditEndedReason | null // 自動で編集を終えた理由（ヘッダーの案内）
  editActions: EditActions | null  // useEditLock が登録する開始/終了
  workflows: WorkflowRow[]
  isSaving: boolean
  lastSavedAt: Date | null
  hasUnsavedChanges: boolean
  isLoadingWorkflow: boolean
  defaultProjectId: string | null
  myProjectIds: string[]           // 自分のプロジェクト ID（所有判定。既定プロジェクトだけでなく全部）

  loadWorkflows(): Promise<void>
  loadWorkflow(id: string): Promise<void>
  saveCurrentWorkflow(viewport?: CanvasViewport): Promise<void>
  createNewWorkflow(name?: string): Promise<void>
  renameWorkflow(id: string, name: string): Promise<void>
  deleteWorkflow(id: string): Promise<void>
  setCurrentWorkflowName(name: string): void
  markUnsavedChanges(): void
  initializeDefaultProject(): Promise<string>
  togglePublic(): Promise<void>
  setVisibility(visibility: WorkflowVisibility): Promise<void>
  setTeamEdit(enabled: boolean): Promise<void>
  setEditing(editing: boolean): void
  setEditLock(view: EditLockView): void
  setEditEnded(reason: EditEndedReason | null): void
  setEditActions(actions: EditActions | null): void
  clearSaveBlocked(): void
  saveCopyOfCurrent(): Promise<string>  // この画面の内容を自分の新しいワークフローとして保存し、その id を返す
  updateThumbnail(workflowId: string, url: string): Promise<void>
  cloneWorkflow(sourceId?: string): Promise<string>  // クローンして新しいworkflowIdを返す
}

export type SaveBlockedKind = 'conflict' | 'lock' | 'forbidden'
export interface SaveBlocked { kind: SaveBlockedKind }
export type EditEndedReason = 'idle' | 'hidden' | 'taken'
export interface EditActions { start: () => Promise<boolean>; stop: () => Promise<void> }

/** 保存にロックが要る（チームの編集を許可 かつ team/public） */
export const selectLockRequired = (s: Pick<WorkflowState, 'currentWorkflowTeamEdit' | 'currentWorkflowVisibility'>): boolean =>
  lockRequiredFor({ team_edit: s.currentWorkflowTeamEdit, visibility: s.currentWorkflowVisibility })
/** いま編集できるか（編集権があり、ロックが要るならこのタブが持っている） */
export const selectCanEditNow = (s: Pick<WorkflowState, 'currentWorkflowTeamEdit' | 'currentWorkflowVisibility' | 'currentWorkflowCanEdit' | 'editing'>): boolean =>
  s.currentWorkflowCanEdit && (!selectLockRequired(s) || s.editing)

// initializeDefaultProject の進行中 Promise（多重呼び出しの合流用）
let defaultProjectInit: Promise<string> | null = null

/** いまのキャンバスを保存用の canvas_data にする（blob: URL を除き、署名 URL を canonical に戻す） */
function localCanvasForSave(viewport?: CanvasViewport): Json {
  const { nodes, edges, capsuleGroupId } = useCanvasStore.getState()
  // blob: URL はセッション限りなので保存から除外する
  const sanitizedNodes = nodes.map((node) => {
    const d = node.data as Record<string, unknown>
    if (!d.uploadedImagePreview && !d.uploadedVideoPreview) return node
    const { uploadedImagePreview: _i, uploadedVideoPreview: _v, ...rest } = d
    return { ...node, data: rest }
  })
  // 非公開バケット化: 署名URL（/object/sign?token=）を保存し直さないよう canonical へ正規化する（書込口）
  const canonicalNodes = canonicalizeCanvasNodes(sanitizedNodes)
  return { nodes: canonicalNodes, edges, viewport: viewport ?? null, capsuleGroupId } as unknown as Json
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  currentWorkflowId: null,
  currentWorkflowName: 'Untitled Workflow',
  currentWorkflowIsPublic: false,
  currentWorkflowVisibility: 'private',
  currentWorkflowIsOwned: true,
  currentWorkflowTeamEdit: false,
  currentWorkflowCanEdit: true,
  currentWorkflowCanvasVersion: 0,
  editing: true,
  editLock: FREE_LOCK,
  editSessionId: editSessionId(typeof sessionStorage !== 'undefined' ? sessionStorage : null, () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)),
  saveBlocked: null,
  editEnded: null,
  editActions: null,
  workflows: [],
  isSaving: false,
  lastSavedAt: null,
  hasUnsavedChanges: false,
  isLoadingWorkflow: false,
  defaultProjectId: null,
  myProjectIds: [],

  async initializeDefaultProject(): Promise<string> {
    const cached = get().defaultProjectId
    if (cached) return cached
    // 同時に複数箇所から呼ばれても既定プロジェクトを二重に作らない（初回ログイン時に
    // 「My Project」が 2 つでき、ワークフローが一覧に出ない/読み取り専用になる不具合の対策）
    if (!defaultProjectInit) {
      defaultProjectInit = (async () => {
        const projects = await getProjects()
        if (projects.length > 0) {
          set({ defaultProjectId: projects[0].id, myProjectIds: projects.map((p) => p.id) })
          return projects[0].id
        }
        const newProject = await createProject({ name: 'My Project' })
        set({ defaultProjectId: newProject.id, myProjectIds: [newProject.id] })
        return newProject.id
      })().finally(() => { defaultProjectInit = null })
    }
    return defaultProjectInit
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
      const canvasData = workflow.canvas_data as { nodes?: AppNode[]; edges?: Edge[]; capsuleGroupId?: string | null } | null

      // 保存済みデータに blob: URL が残っていれば除去する
      // generating 状態のまま保存されたノードは error にリセット（リロード後に永遠に生成中にならないよう）
      const restoredNodes = (canvasData?.nodes ?? []).map((node) => {
        const d = node.data as Record<string, unknown>
        let data = d
        if (typeof d.uploadedImagePreview === 'string' && d.uploadedImagePreview.startsWith('blob:')) {
          const { uploadedImagePreview: _, ...rest } = d
          data = rest
        }
        if (typeof data.uploadedVideoPreview === 'string' && data.uploadedVideoPreview.startsWith('blob:')) {
          const { uploadedVideoPreview: _v, ...rest } = data
          data = rest
        }
        // requestId がある場合はリカバリー対象のため error にリセットしない
        if (data.status === 'generating' && !data.requestId) {
          data = { ...data, status: 'error', errorMessage: 'ページの再読み込みにより生成が中断されました' }
        }
        return { ...node, data }
      })
      // 非公開バケット化(L1)+テナント分離(L2): canonical URL を、サーバーが WF アクセス認可した上で署名URLへ変換
      const signedNodes = await signCanvasNodes(restoredNodes, id)
      // nodes/edges/capsuleGroupId を原子的にセット。
      // 別々に set() すると「エッジ空」のundoスナップショットが混入するため loadCanvasState を使う。
      loadCanvasState(
        signedNodes as AppNode[],
        canvasData?.edges ?? [],
        canvasData?.capsuleGroupId ?? null
      )

      // 所有 = 自分のプロジェクト配下（既定プロジェクトだけでなく全部。プロジェクト行が複数あるユーザーでも誤判定しない）
      const { myProjectIds, defaultProjectId } = get()
      const isOwned = myProjectIds.length > 0 ? myProjectIds.includes(workflow.project_id) : workflow.project_id === defaultProjectId
      const visibility = (workflow as { visibility?: WorkflowVisibility }).visibility
        ?? ((workflow as { is_public?: boolean }).is_public ? 'public' : 'private')
      const teamEdit = (workflow as { team_edit?: boolean }).team_edit ?? false
      const lockRequired = lockRequiredFor({ team_edit: teamEdit, visibility })
      // 編集権: 所有者はそのまま。「チームの編集を許可」のワークフローはサーバーに判定を聞く（同じチームか）
      const canEdit = isOwned || (lockRequired ? await canEditWorkflow(id) : false)
      const sameWorkflow = get().currentWorkflowId === id
      set({
        currentWorkflowId: id,
        currentWorkflowName: workflow.name,
        currentWorkflowIsPublic: (workflow as { is_public?: boolean }).is_public ?? false,
        currentWorkflowVisibility: visibility,
        currentWorkflowIsOwned: isOwned,
        currentWorkflowTeamEdit: teamEdit,
        currentWorkflowCanEdit: canEdit,
        currentWorkflowCanvasVersion: (workflow as { canvas_version?: number | null }).canvas_version ?? 0,
        // ロック不要なら編集権＝そのまま編集。ロックが要るときは useEditLock が取得して editing にする（同じワークフローの読み直しでは状態を保つ）
        editing: lockRequired ? (sameWorkflow ? get().editing : false) : canEdit,
        editLock: sameWorkflow ? get().editLock : FREE_LOCK,
        editEnded: sameWorkflow ? get().editEnded : null,
        saveBlocked: null,
        hasUnsavedChanges: false,
        lastSavedAt: new Date(workflow.updated_at),
      })
    } finally {
      // ロード完了後に少し待ってからフラグを解除（canvasStore の変化通知を一周させる）
      setTimeout(() => set({ isLoadingWorkflow: false }), 100)
    }
  },

  async saveCurrentWorkflow(viewport?: CanvasViewport): Promise<void> {
    const { currentWorkflowId, isSaving, currentWorkflowCanvasVersion } = get()
    if (!currentWorkflowId || isSaving) return
    if (!selectCanEditNow(get())) return   // 閲覧のみ（権限なし・ロック未取得）では保存しない

    set({ isSaving: true })
    try {
      // 版を確かめながら保存する。読み込んだ後に誰か（他の人・別のタブ・Jobs 画面）が保存していたら上書きせず、選んでもらう
      const saved = await updateWorkflowCanvasChecked(currentWorkflowId, localCanvasForSave(viewport), currentWorkflowCanvasVersion)
      if (!saved) {
        set({ saveBlocked: { kind: 'conflict' } })
        return
      }
      // サーバーの updated_at / 版を保持する（他の画面での更新を比較で検知するため）
      set({
        hasUnsavedChanges: false,
        lastSavedAt: saved.updated_at ? new Date(saved.updated_at) : new Date(),
        currentWorkflowCanvasVersion: (saved as { canvas_version?: number | null }).canvas_version ?? currentWorkflowCanvasVersion + 1,
      })
    } catch (err) {
      const kind = classifySaveError(err)
      if (kind === 'lock') { set({ editing: false, saveBlocked: { kind: 'lock' } }); return }
      if (kind === 'forbidden' || kind === 'settings') { set({ saveBlocked: { kind: 'forbidden' } }); return }
      console.warn('[saveCurrentWorkflow] 保存失敗:', err)
      showToast('保存に失敗しました。ネットワーク接続を確認してください。', 'error')
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
      currentWorkflowIsOwned: true,
      currentWorkflowTeamEdit: false,
      currentWorkflowCanEdit: true,
      currentWorkflowCanvasVersion: (workflow as { canvas_version?: number | null }).canvas_version ?? 0,
      editing: true,
      editLock: FREE_LOCK,
      editEnded: null,
      saveBlocked: null,
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
    // 先に配下の生成物（DB行 + Storage ファイル）を削除して孤児化を防ぐ。
    // 失敗してもワークフロー本体の削除は進める（UXを止めない）。
    try {
      await deleteGenerationsByWorkflow(id)
    } catch (err) {
      console.warn('[deleteWorkflow] 生成物のカスケード削除に失敗:', err)
    }
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

  async togglePublic(): Promise<void> {
    const { currentWorkflowId, currentWorkflowIsPublic } = get()
    if (!currentWorkflowId) return
    const next = !currentWorkflowIsPublic
    await toggleWorkflowPublic(currentWorkflowId, next)
    set((state) => ({
      currentWorkflowIsPublic: next,
      currentWorkflowVisibility: next ? 'public' : 'private',
      workflows: state.workflows.map((w) =>
        w.id === currentWorkflowId ? { ...w, is_public: next } : w
      ),
    }))
  },

  async setVisibility(visibility: WorkflowVisibility): Promise<void> {
    const { currentWorkflowId } = get()
    if (!currentWorkflowId) return
    await setWorkflowVisibility(currentWorkflowId, visibility)
    set((state) => ({
      currentWorkflowVisibility: visibility,
      currentWorkflowIsPublic: visibility === 'public',
      workflows: state.workflows.map((w) =>
        w.id === currentWorkflowId ? { ...w, visibility, is_public: visibility === 'public' } : w
      ),
    }))
  },

  async setTeamEdit(enabled: boolean): Promise<void> {
    const { currentWorkflowId, currentWorkflowIsOwned, currentWorkflowCanEdit } = get()
    if (!currentWorkflowId || !currentWorkflowIsOwned) return
    await setWorkflowTeamEdit(currentWorkflowId, enabled)
    set((state) => ({
      currentWorkflowTeamEdit: enabled,
      // ON にしたら保存にロックが要る → useEditLock が取り直すまで閲覧扱い。OFF なら所有者はそのまま編集
      editing: enabled ? false : currentWorkflowCanEdit,
      editEnded: null,
      workflows: state.workflows.map((w) => (w.id === currentWorkflowId ? { ...w, team_edit: enabled } : w)),
    }))
  },

  setEditing(editing: boolean): void { set({ editing }) },
  setEditLock(view: EditLockView): void { set({ editLock: view }) },
  setEditEnded(reason: EditEndedReason | null): void { set({ editEnded: reason }) },
  setEditActions(actions: EditActions | null): void { set({ editActions: actions }) },
  clearSaveBlocked(): void { set({ saveBlocked: null }) },

  async saveCopyOfCurrent(): Promise<string> {
    const projectId = await get().initializeDefaultProject()
    const name = `Copy of ${get().currentWorkflowName}`
    const created = await createWorkflow({ project_id: projectId, name, canvas_data: localCanvasForSave() })
    await get().loadWorkflows()
    return created.id
  },

  async cloneWorkflow(sourceId?: string): Promise<string> {
    const id = sourceId ?? get().currentWorkflowId
    if (!id) throw new Error('No workflow to clone')
    const source = await getWorkflow(id)
    const projectId = await get().initializeDefaultProject()
    const cloned = await createWorkflow({
      project_id: projectId,
      name: `Clone of ${source.name}`,
      canvas_data: source.canvas_data,
      thumbnail_url: (source as { thumbnail_url?: string | null }).thumbnail_url ?? undefined,
    })
    await get().loadWorkflows()
    return cloned.id
  },

  async updateThumbnail(workflowId: string, url: string): Promise<void> {
    if (!workflowId) return
    try {
      await updateWorkflowThumbnail(workflowId, url)
      set((state) => ({
        workflows: state.workflows.map((w) =>
          w.id === workflowId ? { ...w, thumbnail_url: url } : w
        ),
      }))
    } catch {
      // fire-and-forget: サムネイル更新失敗は無視
    }
  },
}))

// 生成結果の書込（patchWorkflowNodeOutput）など、ストアを通らずに canvas_data を進めた経路から版を受け取る（保存の衝突確認がずれないように）
onCanvasVersion((workflowId, version) => {
  const st = useWorkflowStore.getState()
  if (st.currentWorkflowId === workflowId && version > st.currentWorkflowCanvasVersion) useWorkflowStore.setState({ currentWorkflowCanvasVersion: version })
})
