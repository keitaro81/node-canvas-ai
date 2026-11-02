import { describe, it, expect } from 'vitest'
import { appBatchPlanOf, appCanvasOf, appIssueOf, appKindOf, appScopeOf } from './appKind'

describe('appKindOf（App の判定）', () => {
  it('Batch Input があれば batch、App 化したグループがあれば generation、どちらも無ければ null（商品動画の App は 2026-11-01 に廃止）', () => {
    expect(appKindOf({ nodes: [{ type: 'cutSetInputNode', data: { type: 'cutSetInput' } }] })).toBeNull()
    expect(appKindOf({ nodes: [{ type: 'batchInputNode', data: { type: 'batchInput' } }, { type: 'groupNode', data: { capsuleEnabled: true } }] })).toBe('batch')
    expect(appKindOf({ nodes: [{ type: 'groupNode', data: { capsuleEnabled: true } }] })).toBe('generation')
    expect(appKindOf({ nodes: [{ type: 'groupNode', data: { capsuleEnabled: false } }, { type: 'textPromptNode', data: { type: 'textPrompt' } }] })).toBeNull()
    expect(appKindOf(null)).toBeNull()
    expect(appKindOf({})).toBeNull()
  })
})

describe('appScopeOf（App = App 化したグループ・2026-11-02 段階 3）', () => {
  const g = { id: 'g', type: 'groupNode', data: { capsuleEnabled: true } }
  const bi = (id: string, parentId?: string) => ({ id, type: 'batchInputNode', parentId, data: { type: 'batchInput' } })
  it('グループの中の入口の数で種類が決まり、範囲はグループ', () => {
    expect(appScopeOf({ nodes: [g, bi('a', 'g')] })).toEqual({ kind: 'batch', groupId: 'g', entryId: 'a', entryCount: 1 })
    expect(appScopeOf({ nodes: [g, bi('a')] })).toEqual({ kind: 'generation', groupId: 'g', entryId: null, entryCount: 0 })   // 入口がグループの外なら生成 App
    expect(appScopeOf({ nodes: [g, bi('a', 'g'), bi('b', 'g')] })).toEqual({ kind: 'batch', groupId: 'g', entryId: null, entryCount: 2 })
    expect(appScopeOf({ capsuleGroupId: 'g', nodes: [{ id: 'g', type: 'groupNode', data: { capsuleEnabled: false } }, bi('a', 'g')] }).entryId).toBe('a')
  })
  it('救済: App 化したグループが無ければ、Batch Input のあるキャンバス全体が一括 App', () => {
    expect(appScopeOf({ nodes: [bi('a'), bi('b')] })).toEqual({ kind: 'batch', groupId: null, entryId: 'a', entryCount: 2 })
    expect(appScopeOf({ nodes: [{ id: 't', type: 'textPromptNode', data: {} }] }).kind).toBeNull()
  })
})

describe('appBatchPlanOf / appIssueOf（一括 App の結果は 1 種類・2026-11-02）', () => {
  const RB_PARAMS = { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '1024x1024', alphaThreshold: 8, featherPx: 0 }
  const g = { id: 'g', type: 'groupNode', data: { capsuleEnabled: true } }
  const bi = (id: string, parentId?: string) => ({ id, type: 'batchInputNode', parentId, data: { type: 'batchInput', params: {} } })
  const rb = (id: string, parentId?: string) => ({ id, type: 'removeBackgroundNode', parentId, data: { type: 'removeBackground', label: id, params: RB_PARAMS } })
  const tp = (id: string, parentId?: string) => ({ id, type: 'textPromptNode', parentId, data: { type: 'textPrompt', params: { prompt: 'spin' } } })
  const vg = (id: string, parentId?: string) => ({ id, type: 'videoGenerationNode', parentId, data: { type: 'videoGen', label: id, model: 'kling-v3-pro', duration: '3', resolution: '1080p', aspectRatio: 'auto', fps: 25, audioEnabled: false, seed: null, params: {} } })
  const merge = (id: string, parentId?: string) => ({ id, type: 'videoMergeNode', parentId, data: { type: 'videoMerge', label: id, params: {} } })
  const pl = (id: string, parentId?: string) => ({ id, type: 'productLayoutNode', parentId, data: { type: 'productLayout', label: id, params: {} } })
  const e = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })
  const photo = (target: string, handle = 'in-image-image') => e('bi', 'out-image-image', target, handle)
  const text = (target: string) => e('tp', 'out-text-text-out', target, 'in-text')

  it('入口が無ければ null。入口が 2 つ以上は entries', () => {
    expect(appBatchPlanOf({ nodes: [g, rb('rb', 'g')], edges: [] }, 'g')).toBeNull()
    expect(appIssueOf({ nodes: [g, bi('a', 'g'), bi('b', 'g')], edges: [] }, 'g')?.code).toBe('entries')
    expect(appIssueOf({ nodes: [bi('a'), bi('b')], edges: [] }, null)?.code).toBe('entries')   // キャンバス全体（救済）でも同じ
  })
  it('画像だけなら枝分かれしてよい（Remove Background × 2 → 2 つの切り抜き）', () => {
    const p = appBatchPlanOf({ nodes: [g, bi('bi', 'g'), rb('rb1', 'g'), rb('rb2', 'g')], edges: [photo('rb1'), photo('rb2')] }, 'g')!
    expect(p.issue).toBeNull()
    expect(p.entryId).toBe('bi')
    expect(p.tasks.map((t) => `${t.nodeId}:${t.kind}`)).toEqual(['rb1:cutout', 'rb2:cutout'])
  })
  it('画像と動画の両方ができる構成は mixed（動画につながらない切り抜き・Product Layout）', () => {
    const dropped = appIssueOf({ nodes: [g, bi('bi', 'g'), rb('rb', 'g'), tp('tp', 'g'), vg('v1', 'g')], edges: [photo('rb'), photo('v1', 'in-image'), text('v1')] }, 'g')
    expect(dropped?.code).toBe('mixed')
    expect(dropped?.message).toContain('rb')
    const layout = appIssueOf({ nodes: [g, bi('bi', 'g'), rb('rb', 'g'), pl('pl', 'g'), tp('tp', 'g'), vg('v1', 'g')], edges: [photo('rb'), e('rb', 'out-cutout-cutout', 'pl', 'in-cutout-cutout'), e('rb', 'out-cutout-cutout', 'v1', 'in-image'), text('v1')] }, 'g')
    expect(layout?.code).toBe('mixed')
    expect(layout?.message).toContain('pl')
  })
  it('動画は写真 1 枚につき 1 本: 2 本できる構成は videos、Video Merge でまとめれば問題なし', () => {
    const nodes = [g, bi('bi', 'g'), tp('tp', 'g'), vg('v1', 'g'), vg('v2', 'g')]
    const edges = [photo('v1', 'in-image'), photo('v2', 'in-image'), text('v1'), text('v2')]
    expect(appIssueOf({ nodes, edges }, 'g')?.code).toBe('videos')
    const merged = appBatchPlanOf({ nodes: [...nodes, merge('m', 'g')], edges: [...edges, e('v1', 'out-video', 'm', 'in-video-1'), e('v2', 'out-video', 'm', 'in-video-2')] }, 'g')!
    expect(merged.issue).toBeNull()
    expect(merged.tasks.map((t) => `${t.nodeId}:${t.kind}`)).toEqual(['v1:videoShot', 'v2:videoShot', 'm:videoMerge'])
  })
  it('範囲はグループの中だけ: 外のノードと外へ出る辺は計画に入らない', () => {
    const p = appBatchPlanOf({ nodes: [g, bi('bi', 'g'), rb('rb', 'g'), tp('tp'), vg('v1')], edges: [photo('rb'), e('rb', 'out-cutout-cutout', 'v1', 'in-image'), text('v1')] }, 'g')!
    expect(p.issue).toBeNull()
    expect(p.tasks.map((t) => t.nodeId)).toEqual(['rb'])
    expect(p.nodes.map((n) => n.id)).toEqual(['bi', 'rb'])
  })
})

describe('appCanvasOf（App の画面の範囲・2026-11-02 メモ 45）', () => {
  const nodes = [{ id: 'g' }, { id: 'a', parentId: 'g' }, { id: 'b', parentId: 'g' }, { id: 'x' }, { id: 'y', parentId: 'h' }]
  const edges = [{ source: 'a', target: 'b' }, { source: 'a', target: 'x' }, { source: 'x', target: 'b' }, { source: 'y', target: 'a' }]
  it('グループの子と、子どうしの辺だけ。外のノード・外とつながる辺・ほかのグループは入らない', () => {
    const r = appCanvasOf(nodes, edges, 'g')
    expect(r.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(r.edges).toEqual([{ source: 'a', target: 'b' }])
  })
  it('グループが無い（救済）ときはキャンバス全体', () => {
    const r = appCanvasOf(nodes, edges, null)
    expect(r.nodes).toBe(nodes)
    expect(r.edges).toBe(edges)
  })
})
