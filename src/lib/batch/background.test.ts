import { describe, it, expect } from 'vitest'
import { backgroundSourcesOf, interactiveBackgroundUrl, promptForGenerator, resolveBackgroundSource } from './background'

const canvas = {
  nodes: [
    { id: 'tp', data: { type: 'textPrompt', params: { prompt: 'beige studio' } } },
    { id: 'gen', data: { type: 'imageGen', params: { model: 'fal-ai/nano-banana-2', executionScope: 'job' } } },
    { id: 'disp', data: { type: 'imageDisplay', output: 'https://x/bg.png' } },
    { id: 'ref', data: { type: 'referenceImage', imageUrl: 'https://x/ref.png' } },
    { id: 'pl-direct', data: { type: 'productLayout', params: { backgroundKind: 'image' } } },
    { id: 'pl-disp', data: { type: 'productLayout', params: { backgroundKind: 'image' } } },
    { id: 'pl-ref', data: { type: 'productLayout', params: { backgroundKind: 'image' } } },
    { id: 'pl-color', data: { type: 'productLayout', params: { backgroundKind: 'color' } } },
    { id: 'pl-none', data: { type: 'productLayout', params: { backgroundKind: 'image' } } },
  ],
  edges: [
    { source: 'tp', sourceHandle: 'out-text-text-out', target: 'gen', targetHandle: 'in-text' },
    { source: 'gen', sourceHandle: 'out-image-image-out', target: 'disp', targetHandle: 'in-image-image-in' },
    { source: 'gen', sourceHandle: 'out-image-image-out', target: 'pl-direct', targetHandle: 'in-image-background' },
    { source: 'disp', sourceHandle: 'out-image-image', target: 'pl-disp', targetHandle: 'in-image-background' },
    { source: 'ref', sourceHandle: 'out-image', target: 'pl-ref', targetHandle: 'in-image-background' },
  ],
}
const urlOf = (d: Record<string, unknown> | undefined) => (typeof d?.output === 'string' ? d.output : typeof d?.imageUrl === 'string' ? d.imageUrl : null)

describe('背景の出どころ', () => {
  it('Image Generation 直結・結果ノード経由はどちらも生成器に行き着く。固定画像は生成器なし', () => {
    expect(resolveBackgroundSource(canvas, 'pl-direct')).toEqual({ layoutNodeId: 'pl-direct', sourceNodeId: 'gen', generatorNodeId: 'gen' })
    expect(resolveBackgroundSource(canvas, 'pl-disp')).toEqual({ layoutNodeId: 'pl-disp', sourceNodeId: 'disp', generatorNodeId: 'gen' })
    expect(resolveBackgroundSource(canvas, 'pl-ref')).toEqual({ layoutNodeId: 'pl-ref', sourceNodeId: 'ref', generatorNodeId: null })
    expect(resolveBackgroundSource(canvas, 'pl-none')).toBeNull()
  })
  it('背景が「画像」のレイアウトだけを列挙する', () => {
    expect(backgroundSourcesOf(canvas).map((s) => s.layoutNodeId)).toEqual(['pl-direct', 'pl-disp', 'pl-ref'])
  })
  it('プロンプトは上流のテキストノードから集める', () => {
    expect(promptForGenerator(canvas, 'gen')).toBe('beige studio')
    expect(promptForGenerator({ nodes: [{ id: 'g', data: { type: 'imageGen', params: { prompt: 'own' } } }], edges: [] }, 'g')).toBe('own')
  })
  it('対話実行の背景 URL: 直結なら結果ノードの出力、固定画像ならそのまま', () => {
    expect(interactiveBackgroundUrl(canvas, 'pl-direct', urlOf)).toBe('https://x/bg.png')
    expect(interactiveBackgroundUrl(canvas, 'pl-disp', urlOf)).toBe('https://x/bg.png')
    expect(interactiveBackgroundUrl(canvas, 'pl-ref', urlOf)).toBe('https://x/ref.png')
    expect(interactiveBackgroundUrl(canvas, 'pl-none', urlOf)).toBeNull()
  })
})

describe('背景の出どころ: Image Generation 直結のレイアウトが自分の出力を背景にしない（描き直しループの回帰）', () => {
  it('結果ノードが無ければ null、あれば結果ノードの出力。レイアウト自身の output は使わない', () => {
    const c = {
      nodes: [
        { id: 'gen', data: { type: 'imageGen', params: {} } },
        { id: 'pl', data: { type: 'productLayout', params: { backgroundKind: 'image' }, output: 'https://x/pl-own-output.png' } },
      ],
      edges: [{ source: 'gen', sourceHandle: 'out-image-image-out', target: 'pl', targetHandle: 'in-image-background' }],
    }
    expect(interactiveBackgroundUrl(c, 'pl', urlOf)).toBeNull()
    const withDisplay = { nodes: [...c.nodes, { id: 'disp', data: { type: 'imageDisplay', output: 'https://x/bg.png' } }], edges: [...c.edges, { source: 'gen', sourceHandle: 'out-image-image-out', target: 'disp', targetHandle: 'in-image-image-in' }] }
    expect(interactiveBackgroundUrl(withDisplay, 'pl', urlOf)).toBe('https://x/bg.png')
  })
})
