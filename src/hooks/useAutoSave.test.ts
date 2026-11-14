import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 自動保存（変更の 3 秒後）と、生成の依頼 id の保存が重なったときの振る舞い（2026-11-14 メモ 85）。
// 本番で起きた並び: 「生成中」になった 3 秒後の自動保存の最中に fal から依頼 id が届く → 依頼 id の保存が捨てられ、
// 自動保存も「保存中の変更」を無視していたので、その依頼 id はどこにも保存されなかった。

const h = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('../lib/api/workflows', () => ({
  getWorkflows: vi.fn(async () => []), getWorkflow: vi.fn(), createWorkflow: vi.fn(), updateWorkflow: vi.fn(), deleteWorkflow: vi.fn(),
  updateWorkflowThumbnail: vi.fn(), toggleWorkflowPublic: vi.fn(), setWorkflowVisibility: vi.fn(), setWorkflowTeamEdit: vi.fn(),
  canEditWorkflow: vi.fn(async () => true),
  updateWorkflowCanvasChecked: h.update,
}))
vi.mock('../lib/api/projects', () => ({ getProjects: vi.fn(async () => []), createProject: vi.fn() }))
vi.mock('../lib/api/generations', () => ({ deleteGenerationsByWorkflow: vi.fn() }))
vi.mock('../lib/api/signMedia', () => ({ canonicalizeCanvasNodes: (n: unknown) => n, signCanvasNodes: async (n: unknown) => n }))
vi.mock('./useToast', () => ({ showToast: vi.fn() }))

import { startAutoSave } from './useAutoSave'
import { useWorkflowStore } from '../stores/workflowStore'
import { useCanvasStore, type AppNode } from '../stores/canvasStore'

type Saved = { canvas_version: number; updated_at: string } | null
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
const saved = (version: number): Saved => ({ canvas_version: version, updated_at: '2026-11-14T10:00:00.000Z' })
const state = () => useWorkflowStore.getState()
const update = (data: Record<string, unknown>) => useCanvasStore.getState().updateNode('result', data as never)
const sentCanvas = (n: number) => JSON.stringify(h.update.mock.calls[n - 1][1])
let stop: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  h.update.mockReset()
  useWorkflowStore.setState({
    currentWorkflowId: 'w1', currentWorkflowCanEdit: true, currentWorkflowTeamEdit: false, currentWorkflowVisibility: 'private', editing: true,
    currentWorkflowCanvasVersion: 1, isSaving: false, isLoadingWorkflow: false, hasUnsavedChanges: false, saveBlocked: null,
  })
  useCanvasStore.setState({ nodes: [{ id: 'result', type: 'imageDisplayNode', position: { x: 0, y: 0 }, data: { type: 'imageDisplay', label: 'Result', params: {}, status: 'idle' } } as unknown as AppNode], edges: [] })
  stop = startAutoSave(3000)
})
afterEach(() => { stop(); vi.useRealTimers() })

describe('自動保存', () => {
  it('変更の 3 秒後に 1 回保存する（続けて変更したら、最後の変更から 3 秒）', async () => {
    h.update.mockResolvedValue(saved(2))
    update({ status: 'generating' })
    expect(state().hasUnsavedChanges).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    update({ note: 'x' })
    await vi.advanceTimersByTimeAsync(2999)
    expect(h.update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(state().hasUnsavedChanges).toBe(false)
  })

  it('保存の最中に入った変更も捨てない: 保存が終わっても未保存のままで、3 秒後に保存する', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise).mockResolvedValue(saved(3))
    update({ status: 'generating' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(state().isSaving).toBe(true)

    update({ requestId: 'r1', requestEndpoint: 'google/nano-banana-2.1' })   // 保存の最中の変更
    first.resolve(saved(2))
    await vi.advanceTimersByTimeAsync(0)
    expect(state().isSaving).toBe(false)
    expect(state().hasUnsavedChanges).toBe(true)        // 1 回目の中身には入っていない

    await vi.advanceTimersByTimeAsync(3000)
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(sentCanvas(2)).toContain('"requestId":"r1"')
    expect(state().hasUnsavedChanges).toBe(false)
  })

  it('本番で起きた並び: 自動保存の最中に依頼 id が届いて保存を頼む → 自動保存が終わりしだい、依頼 id 入りで保存される（3 秒待たない）', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise).mockResolvedValue(saved(3))
    update({ status: 'generating' })                    // Generate を押した
    await vi.advanceTimersByTimeAsync(3000)             // 3 秒後の自動保存が始まる（依頼 id はまだ無い）
    expect(sentCanvas(1)).not.toContain('requestId')

    update({ requestId: 'r1', requestEndpoint: 'google/nano-banana-2.1' })   // fal から依頼 id が届く
    void state().saveCurrentWorkflow()                  // 「復旧できるように」保存（ImageGenerationNode / TryOnNode / VideoGenerationNode）
    expect(h.update).toHaveBeenCalledTimes(1)

    first.resolve(saved(2))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.update).toHaveBeenCalledTimes(2)           // すぐ続けて保存
    expect(sentCanvas(2)).toContain('"requestId":"r1"')
    expect(state().hasUnsavedChanges).toBe(false)
  })

  it('読み込み中・編集できない状態の変更では保存しない', async () => {
    h.update.mockResolvedValue(saved(2))
    useWorkflowStore.setState({ isLoadingWorkflow: true })
    update({ status: 'done' })
    useWorkflowStore.setState({ isLoadingWorkflow: false, currentWorkflowCanEdit: false })
    update({ status: 'idle' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.update).not.toHaveBeenCalled()
    expect(state().hasUnsavedChanges).toBe(false)
  })
})
