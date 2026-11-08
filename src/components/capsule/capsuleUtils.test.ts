import { describe, it, expect } from 'vitest'
import type { Edge } from '@xyflow/react'
import type { AppNode } from '../../stores/canvasStore'
import { buildCapsuleInputNodes, buildCapsuleStages, downstreamLinksOf, hasParallelGenerationNodes, rewireDownstream } from './capsuleUtils'

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

describe('生成 App のステージに Try-On（2026-11-08 メモ 78）', () => {
  const g = { id: 'g', type: 'groupNode', position: { x: 0, y: 0 }, data: { label: 'App', capsuleEnabled: true } } as unknown as AppNode
  const base = () => [
    g,
    node('ri', 'referenceImageNode', { type: 'referenceImage', label: 'ラフ' }),
    node('tp', 'textPromptNode', { type: 'textPrompt' }),
    node('ig', 'imageGenerationNode', { type: 'imageGen', label: 'Image Generation', capsuleFields: {} }),
    node('m', 'libraryModelNode', { type: 'libraryModel', label: 'Model', modelId: null, modelName: null, cuts: {} }),
    node('t', 'tryOnNode', { type: 'tryOn', label: 'Try-On', params: {} }),
    node('d1', 'imageDisplayNode', { type: 'imageDisplay', output: 'https://x/1.png', status: 'done' }),
    node('d2', 'imageDisplayNode', { type: 'imageDisplay', output: 'https://x/2.png', status: 'done' }),
  ]
  const wiring = () => [
    e('ri', 'out-image', 'ig', 'in-image'), e('tp', 'out-text-text-out', 'ig', 'in-text'),
    e('ig', 'out-image-image-out', 'd1', 'in-image-image-in'), e('ig', 'out-image-image-out', 'd2', 'in-image-image-in'),
    e('ig', 'out-image-image-out', 't', 'in-image-garment'),   // チャットで組んだ直後: Image Generation 自体から Try-On へ
    e('m', 'out-image-front', 't', 'in-image-model'),
  ]
  it('Image Generation → Try-On は 2 ステージ。Try-On のステージには Model ノードが「モデル」の入力として付く', () => {
    const stages = buildCapsuleStages('g', base(), wiring())
    expect(stages.map((s) => `${s.nodeType}:${s.label}`)).toEqual(['imageGen:Image Generation', 'tryOn:Try-On'])
    expect(stages[0].displayNodeIds).toEqual(['d1', 'd2'])
    expect(stages[1].stageInputs.map((i) => `${i.nodeType}:${i.label}`)).toEqual(['libraryModel:Model'])
    expect(buildCapsuleInputNodes('g', base(), wiring(), stages).map((i) => i.nodeId)).toEqual([])
  })
  it('次のステージへの線は、結果ノードからの線も、ステージのノード自体からの線も拾う。選ぶと、選んだ結果ノードからの線に付け替わる', () => {
    const nodes = base(), edges = wiring()
    const stages = buildCapsuleStages('g', nodes, edges)
    const links = downstreamLinksOf(stages[0], nodes, edges)
    expect(links).toEqual([{ sourceId: 'ig', genNodeId: 't', targetHandle: 'in-image-garment' }])
    const after = rewireDownstream('d2', stages[0], links, nodes, edges)
    expect(after.filter((x) => x.target === 't').map((x) => `${x.source}.${x.sourceHandle}→${x.targetHandle}`).sort()).toEqual(['d2.out-image-image-out→in-image-garment', 'm.out-image-front→in-image-model'])
    expect(after.filter((x) => x.target === 'd1' || x.target === 'd2').length).toBe(2)   // Image Generation → 結果ノードの線はそのまま
    // 選び直し: d2 → d1
    const links2 = downstreamLinksOf(stages[0], nodes, after)
    expect(links2).toEqual([{ sourceId: 'd2', genNodeId: 't', targetHandle: 'in-image-garment' }])
    const again = rewireDownstream('d1', stages[0], links2, nodes, after)
    expect(again.filter((x) => x.target === 't' && x.targetHandle === 'in-image-garment').map((x) => x.source)).toEqual(['d1'])
    expect(rewireDownstream('d1', stages[0], [], nodes, after)).toBe(after)   // 線が無ければそのまま
  })
  it('並列の判定（App 化の可否）は従来どおり画像・動画の生成だけ: Model から Try-On を 2 つ並べても並列にしない', () => {
    const nodes = [g, node('m', 'libraryModelNode', { type: 'libraryModel' }), node('ra', 'referenceImageNode', { type: 'referenceImage' }), node('rb', 'referenceImageNode', { type: 'referenceImage' }), node('t1', 'tryOnNode', { type: 'tryOn' }), node('t2', 'tryOnNode', { type: 'tryOn' })]
    const edges = [e('m', 'out-image-front', 't1', 'in-image-model'), e('ra', 'out-image', 't1', 'in-image-garment'), e('m', 'out-image-right', 't2', 'in-image-model'), e('rb', 'out-image', 't2', 'in-image-garment')]
    expect(hasParallelGenerationNodes('g', nodes, edges)).toBe(false)
    expect(buildCapsuleStages('g', nodes, edges).map((s) => s.nodeId)).toEqual(['t1', 't2'])
  })
})
