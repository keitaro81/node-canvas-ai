import { describe, it, expect } from 'vitest'
import type { Edge } from '@xyflow/react'
import type { AppNode } from '../../stores/canvasStore'
import { buildCapsuleInputNodes, buildCapsuleStages } from './capsuleUtils'

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, parentId: 'g', position: { x: 0, y: 0 }, data }) as unknown as AppNode
const e = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ id: `${source}-${target}`, source, sourceHandle, target, targetHandle }) as Edge

describe('生成 App の入力（2026-11-08 メモ 69: Reference Video も入力として出す）', () => {
  const g = { id: 'g', type: 'groupNode', position: { x: 0, y: 0 }, data: { label: 'App', capsuleEnabled: true } } as unknown as AppNode
  it('Video Generation につないだ Reference Video はそのステージの入力に出る（名前が無ければ「参照動画」）', () => {
    const nodes = [g, node('rv', 'referenceVideoNode', { type: 'referenceVideo', videoUrl: 'https://x/a.mp4' }), node('ri', 'referenceImageNode', { type: 'referenceImage', label: '服' }), node('vg', 'videoGenerationNode', { type: 'videoGen', capsuleFields: {} })]
    const edges = [e('rv', 'out-video', 'vg', 'in-video'), e('ri', 'out-image', 'vg', 'in-image')]
    const stages = buildCapsuleStages('g', nodes, edges)
    expect(stages[0].stageInputs.map((i) => `${i.nodeType}:${i.label}`).sort()).toEqual(['referenceImage:服', 'referenceVideo:参照動画'])
    expect(buildCapsuleInputNodes('g', nodes, edges, stages)).toEqual([])
  })
  it('「表示」を外した Reference Video は出さない。List の動画のスロットにつないだものは List の欄に出るので全体の入力にしない', () => {
    const hidden = node('rv', 'referenceVideoNode', { type: 'referenceVideo', capsuleFields: { videoUrl: { id: 'videoUrl', capsuleVisibility: 'hidden' } } })
    const nodes = [g, hidden, node('rv2', 'referenceVideoNode', { type: 'referenceVideo' }), node('li', 'listNode', { type: 'list', mode: 'video' }), node('vg', 'videoGenerationNode', { type: 'videoGen', capsuleFields: {} })]
    const edges = [e('rv', 'out-video', 'vg', 'in-video'), e('rv2', 'out-video', 'li', 'in-video-0'), e('li', 'out-list', 'vg', 'in-list')]
    const stages = buildCapsuleStages('g', nodes, edges)
    expect(stages[0].stageInputs).toEqual([])
    expect(buildCapsuleInputNodes('g', nodes, edges, stages)).toEqual([])
  })
})
