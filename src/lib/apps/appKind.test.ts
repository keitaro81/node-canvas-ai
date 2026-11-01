import { describe, it, expect } from 'vitest'
import { appKindOf } from './appKind'

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
