import { describe, it, expect, beforeEach, vi } from 'vitest'

// 保存の直列化（2026-11-14 メモ 85）。保存の最中に来た保存の依頼を捨てないこと。
// 以前は捨てていたため、生成の依頼 id が自動保存の最中に届くと、その依頼 id は次に何か編集するまで保存されず、
// その間にページを読み込み直すと生成の結果を取り戻せなかった（本番で発生: 画面は「生成に失敗しました」・fal 側は成功）。

const h = vi.hoisted(() => ({ update: vi.fn(), toast: vi.fn() }))
vi.mock('../lib/api/workflows', () => ({
  getWorkflows: vi.fn(async () => []), getWorkflow: vi.fn(), createWorkflow: vi.fn(), updateWorkflow: vi.fn(), deleteWorkflow: vi.fn(),
  updateWorkflowThumbnail: vi.fn(), toggleWorkflowPublic: vi.fn(), setWorkflowVisibility: vi.fn(), setWorkflowTeamEdit: vi.fn(),
  canEditWorkflow: vi.fn(async () => true),
  updateWorkflowCanvasChecked: h.update,
}))
vi.mock('../lib/api/projects', () => ({ getProjects: vi.fn(async () => []), createProject: vi.fn() }))
vi.mock('../lib/api/generations', () => ({ deleteGenerationsByWorkflow: vi.fn() }))
vi.mock('../lib/api/signMedia', () => ({ canonicalizeCanvasNodes: (n: unknown) => n, signCanvasNodes: async (n: unknown) => n }))
vi.mock('../hooks/useToast', () => ({ showToast: h.toast }))

import { useWorkflowStore } from './workflowStore'
import { useCanvasStore, type AppNode } from './canvasStore'

type Saved = { canvas_version: number; updated_at: string } | null
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const saved = (version: number): Saved => ({ canvas_version: version, updated_at: '2026-11-14T10:00:00.000Z' })
const node = (data: Record<string, unknown>): AppNode => ({ id: 'result', type: 'imageDisplayNode', position: { x: 0, y: 0 }, data: { type: 'imageDisplay', label: 'Result', params: {}, ...data } } as unknown as AppNode)
const state = () => useWorkflowStore.getState()
const save = () => state().saveCurrentWorkflow()
/** n 回目の保存で送ったキャンバス（JSON 文字列）と、前提にした版 */
const sent = (n: number) => { const c = h.update.mock.calls[n - 1]; return { canvas: JSON.stringify(c[1]), version: c[2] as number } }

beforeEach(() => {
  h.update.mockReset()
  h.toast.mockReset()
  useWorkflowStore.setState({
    currentWorkflowId: 'w1', currentWorkflowCanEdit: true, currentWorkflowTeamEdit: false, currentWorkflowVisibility: 'private', editing: true,
    currentWorkflowCanvasVersion: 1, isSaving: false, isLoadingWorkflow: false, hasUnsavedChanges: false, saveBlocked: null,
  })
  useCanvasStore.setState({ nodes: [node({ status: 'generating' })], edges: [] })
})

describe('保存の最中に来た保存の依頼', () => {
  it('捨てない: いまの保存が終わったら、最新のキャンバスでもう 1 回保存する（生成の依頼 id が自動保存の最中に届いた場合）', async () => {
    const first = deferred<Saved>(), second = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const p1 = save()                                   // 自動保存（「生成中」になった 3 秒後・依頼 id はまだ無い）
    expect(state().isSaving).toBe(true)
    expect(sent(1).canvas).not.toContain('requestId')

    // 保存の最中に、fal から依頼 id が届く → ノードに入れて「復旧できるように」保存を頼む
    useCanvasStore.setState({ nodes: [node({ status: 'generating', requestId: 'r1', requestEndpoint: 'google/nano-banana-2.1' })] })
    await save()
    expect(h.update).toHaveBeenCalledTimes(1)           // まだ 1 回目の最中。ここで待たせない

    first.resolve(saved(2))
    await p1
    await flush()
    expect(h.update).toHaveBeenCalledTimes(2)           // 続けてもう 1 回
    expect(sent(2).canvas).toContain('"requestId":"r1"')
    expect(sent(2).version).toBe(2)                     // 1 回目で進んだ版を前提にする（自分の保存と衝突しない）
    expect(state().isSaving).toBe(true)

    second.resolve(saved(3))
    await flush()
    expect(state().isSaving).toBe(false)
    expect(state().currentWorkflowCanvasVersion).toBe(3)
    expect(h.update).toHaveBeenCalledTimes(2)           // それ以上は走らない
  })

  it('何回重なっても、追加の保存は 1 回にまとめる', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise).mockResolvedValue(saved(3))
    const p1 = save()
    await save(); await save(); await save()
    first.resolve(saved(2))
    await p1
    await flush()
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(state().isSaving).toBe(false)
  })

  it('重なっていなければ、保存は 1 回だけ', async () => {
    h.update.mockResolvedValue(saved(2))
    await save()
    await flush()
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(state().isSaving).toBe(false)
  })

  it('衝突（ほかの画面が先に保存していた）のあとは、続けて保存しない（ダイアログで選んでもらう）', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise)
    const p1 = save()
    await save()
    first.resolve(null)
    await p1
    await flush()
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(state().saveBlocked).toEqual({ kind: 'conflict' })
    expect(state().isSaving).toBe(false)
  })

  it('編集ロックが切れていたときも、続けて保存しない', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise)
    const p1 = save()
    await save()
    first.reject(new Error('workflow_edit_lock_required'))
    await p1
    await flush()
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(state().saveBlocked).toEqual({ kind: 'lock' })
    expect(state().editing).toBe(false)
  })

  it('通信の失敗のあとは、待っていた分を 1 回だけ試す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise).mockResolvedValueOnce(saved(2))
    const p1 = save()
    useCanvasStore.setState({ nodes: [node({ status: 'generating', requestId: 'r1', requestEndpoint: 'google/nano-banana-2.1' })] })
    await save()
    first.reject(new Error('Failed to fetch'))
    await p1
    await flush()
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(sent(2).canvas).toContain('"requestId":"r1"')
    expect(sent(2).version).toBe(1)                     // 1 回目は保存できていないので、版はそのまま
  })

  it('別のワークフローに移っていたら、続きの保存はしない（別のワークフローに書き込まない）', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise)
    const p1 = save()
    await save()
    useWorkflowStore.setState({ currentWorkflowId: 'w2' })
    first.resolve(saved(2))
    await p1
    await flush()
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('読み込みの最中も、続きの保存はしない', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise)
    const p1 = save()
    await save()
    useWorkflowStore.setState({ isLoadingWorkflow: true })
    first.resolve(saved(2))
    await p1
    await flush()
    expect(h.update).toHaveBeenCalledTimes(1)
  })
})

describe('「未保存の変更あり」の表示', () => {
  it('保存の最中に入った変更は、その保存が終わっても未保存のまま', async () => {
    const first = deferred<Saved>()
    h.update.mockReturnValueOnce(first.promise)
    state().markUnsavedChanges()
    const p1 = save()
    state().markUnsavedChanges()                        // 保存の最中の変更（この保存の中身には入っていない）
    first.resolve(saved(2))
    await p1
    expect(state().hasUnsavedChanges).toBe(true)
  })

  it('保存の最中に変更が無ければ、保存済みになる', async () => {
    h.update.mockResolvedValue(saved(2))
    state().markUnsavedChanges()
    await save()
    expect(state().hasUnsavedChanges).toBe(false)
  })
})
