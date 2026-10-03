import { describe, it, expect } from 'vitest'
import { buildProfile, describeImport, parseProfile, planProfileImport, profileFileName, PROFILE_FORMAT, type PostProductionProfile } from './profile'
import { DEFAULT_LAYOUT_PARAMS } from '../layout/computeLayout'
import sampleText from '../../../docs/profiles/sample-ec-sns.ppprofile.json?raw'

const seqIds = () => { let n = 0; return (kind: string) => `${kind}-${++n}` }
const sample: PostProductionProfile = {
  format: PROFILE_FORMAT, version: 1, name: 'sample', exportedAt: '2026-10-03T00:00:00.000Z',
  input: { skuPattern: '^([A-Z0-9-]+)_', sortOrder: 'filename' },
  cutout: { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '2048x2048', alphaThreshold: 8, featherPx: 0 },
  backgrounds: [{ key: 'bg_1', model: 'fal-ai/nano-banana-2', prompt: 'beige studio backdrop', aspectRatio: '9:16', resolution: '1K', seed: null }],
  variants: [
    { ...DEFAULT_LAYOUT_PARAMS, variantName: 'ec_white', background: null },
    { ...DEFAULT_LAYOUT_PARAMS, variantName: 'sns_story', width: 1080, height: 1920, backgroundKind: 'image', backgroundFit: 'cover', shadowKind: 'contact', background: 'bg_1' },
  ],
  export: { namePattern: '{sku}_{variant}_{index:02}', format: 'jpeg', jpegQuality: 90, maxFileKb: null, zip: true, zipFolders: 'variant', includeCutout: true },
}

describe('プロファイル: 空のグラフに読み込む → 書き出すと同じ内容に戻る', () => {
  it('ノードと接続が組まれ、書き出しが一致する', () => {
    const plan = planProfileImport({ nodes: [], edges: [] }, sample, seqIds())
    const types = plan.canvas.nodes.map((n) => n.data?.type)
    expect(types).toEqual(expect.arrayContaining(['batchInput', 'removeBackground', 'productLayout', 'productLayout', 'textPrompt', 'imageGen', 'export']))
    expect(plan.summary.addedVariants).toEqual(['ec_white', 'sns_story'])
    expect(plan.summary.addedBackgrounds).toBe(1)
    // Batch Input → Remove Background → 各 Product Layout → Export、Text Prompt → Image Generation → sns_story の背景入力
    const e = plan.canvas.edges
    expect(e.some((x) => x.source === 'batchInput-1' && x.target === 'removeBackground-2' && x.targetHandle === 'in-image-image')).toBe(true)
    expect(e.filter((x) => x.source === 'removeBackground-2' && x.targetHandle === 'in-cutout-cutout')).toHaveLength(2)
    expect(e.filter((x) => x.targetHandle?.startsWith('in-image-') && x.target.startsWith('export-'))).toHaveLength(2)
    const gen = plan.canvas.nodes.find((n) => n.data?.type === 'imageGen')!
    expect((gen.data?.params as Record<string, unknown>).executionScope).toBe('job')
    expect(e.some((x) => x.source === gen.id && x.targetHandle === 'in-image-background')).toBe(true)
    const { profile, warnings } = buildProfile(plan.canvas, 'sample', new Date('2026-10-03T00:00:00.000Z'))
    expect(warnings).toEqual([])
    expect(profile).toEqual(sample)
  })
  it('parse → 読み込み: 不明な項目は無視し、無い項目は既定値、重複名は付け直し、未知の背景キーは外す', () => {
    const text = JSON.stringify({ ...sample, extra: 1, variants: [
      { variantName: 'a', width: 500 }, { variantName: 'a', background: 'nope' }, { variantName: 'b', unknownField: true },
    ], backgrounds: [{ key: 'bg_1', prompt: 'x' }, { key: '', prompt: 'y' }, { key: 'bg_1', prompt: 'dup' }] })
    const r = parseProfile(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profile.variants.map((v) => v.variantName)).toEqual(['a', 'a_2', 'b'])
    expect(r.profile.variants[0].width).toBe(500)
    expect(r.profile.variants[0].height).toBe(DEFAULT_LAYOUT_PARAMS.height)
    expect(r.profile.variants[1].background).toBeNull()
    expect(r.profile.backgrounds).toEqual([{ key: 'bg_1', model: 'fal-ai/nano-banana-2', prompt: 'x', aspectRatio: '1:1', resolution: '1K', seed: null }])
    expect(r.warnings.length).toBeGreaterThanOrEqual(3)
  })
  it('形式違い・新しい版は拒否', () => {
    expect(parseProfile('nope').ok).toBe(false)
    expect(parseProfile(JSON.stringify({ format: 'other', version: 1 })).ok).toBe(false)
    expect(parseProfile(JSON.stringify({ format: PROFILE_FORMAT, version: 99 })).ok).toBe(false)
  })
})

describe('プロファイル: 既存のグラフに当てる', () => {
  const existing = {
    nodes: [
      { id: 'bi', type: 'batchInputNode', position: { x: 0, y: 0 }, data: { type: 'batchInput', params: { skuPattern: 'old' }, items: [{ id: 'i1' }] } },
      { id: 'rb', type: 'removeBackgroundNode', position: { x: 400, y: 0 }, data: { type: 'removeBackground', params: { engine: 'bria', previewBg: 'white' }, output: { keep: true } } },
      { id: 'pl1', type: 'productLayoutNode', position: { x: 800, y: 0 }, data: { type: 'productLayout', params: { ...DEFAULT_LAYOUT_PARAMS, variantName: 'ec_white', width: 999 }, layout: { path: 'keep' } } },
      { id: 'pl2', type: 'productLayoutNode', position: { x: 800, y: 700 }, data: { type: 'productLayout', params: { ...DEFAULT_LAYOUT_PARAMS, variantName: 'old_variant' } } },
      { id: 'tp', type: 'textPromptNode', position: { x: 0, y: 900 }, data: { type: 'textPrompt', params: { prompt: 'beige studio backdrop' } } },
      { id: 'gen', type: 'imageGenerationNode', position: { x: 400, y: 900 }, data: { type: 'imageGen', params: { model: 'fal-ai/nano-banana-2', executionScope: 'item' } } },
      { id: 'ex', type: 'exportNode', position: { x: 1200, y: 0 }, data: { type: 'export', params: { format: 'png' } } },
    ],
    edges: [
      { source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
      { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl1', targetHandle: 'in-cutout-cutout' },
      { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl2', targetHandle: 'in-cutout-cutout' },
      { source: 'tp', sourceHandle: 'out-text-text-out', target: 'gen', targetHandle: 'in-text' },
      { source: 'pl1', sourceHandle: 'out-image-image', target: 'ex', targetHandle: 'in-image-0' },
    ],
  }
  it('既存ノードは id を保って更新、名前の無いバリアントは削除、新しいバリアントは追加、同じ背景生成は使い回す', () => {
    const plan = planProfileImport(existing, sample, seqIds())
    expect(plan.summary).toMatchObject({ updatedVariants: ['ec_white'], addedVariants: ['sns_story'], removedVariants: ['old_variant'], addedBackgrounds: 0, createdNodes: [] })
    const n = (id: string) => plan.canvas.nodes.find((x) => x.id === id)!
    expect((n('bi').data?.params as Record<string, unknown>).skuPattern).toBe('^([A-Z0-9-]+)_')
    expect(n('bi').data?.items).toEqual([{ id: 'i1' }])                       // 投入済みの一覧は残す
    expect((n('rb').data?.params as Record<string, unknown>)).toMatchObject({ engine: 'birefnet', previewBg: 'white' })  // 画面専用の値は残す
    expect(n('rb').data?.output).toEqual({ keep: true })                      // 切り抜き結果は残す
    expect((n('pl1').data?.params as Record<string, unknown>).width).toBe(1200)
    expect(n('pl1').data?.layout).toEqual({ path: 'keep' })
    expect(plan.canvas.nodes.some((x) => x.id === 'pl2')).toBe(false)
    expect((n('gen').data?.params as Record<string, unknown>).executionScope).toBe('job')   // 使い回した生成器はジョブごとに
    const sns = plan.canvas.nodes.find((x) => (x.data?.params as Record<string, unknown>)?.variantName === 'sns_story')!
    expect(plan.canvas.edges.some((e) => e.source === 'gen' && e.target === sns.id && e.targetHandle === 'in-image-background')).toBe(true)
    expect(plan.canvas.edges.some((e) => e.source === sns.id && e.target === 'ex' && e.targetHandle === 'in-image-1')).toBe(true)   // 空きスロットへ
    expect((n('ex').data?.params as Record<string, unknown>).format).toBe('jpeg')
  })
  it('要約文とファイル名', () => {
    expect(describeImport({ updatedVariants: ['a'], addedVariants: [], removedVariants: ['b'], addedBackgrounds: 1, createdNodes: [] })).toEqual(['バリアントを更新: a', 'バリアントを削除: b', '背景生成を追加: 1 件'])
    expect(profileFileName('EC/SNS: 2026')).toBe('EC_SNS_ 2026.ppprofile.json')
  })
})

describe('リポジトリのサンプルプロファイル', () => {
  it('docs/profiles/sample-ec-sns.ppprofile.json は警告なしに読め、空のグラフに組める', () => {
    const r = parseProfile(sampleText)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toEqual([])
    const plan = planProfileImport({ nodes: [], edges: [] }, r.profile, seqIds())
    expect(plan.summary.addedVariants).toEqual(['ec_white', 'sns_story'])
    expect(plan.summary.addedBackgrounds).toBe(1)
    const back = buildProfile(plan.canvas, r.profile.name, new Date(r.profile.exportedAt))
    expect(back.profile).toEqual(r.profile)
  })
})
