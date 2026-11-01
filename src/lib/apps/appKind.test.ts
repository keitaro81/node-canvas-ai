import { describe, it, expect } from 'vitest'
import { appKindOf, appScopeOf } from './appKind'

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
