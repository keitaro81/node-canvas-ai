import { describe, it, expect } from 'vitest'
import { compileWorkflow } from './compile'
import { parseAgentReply } from './dsl'
import { buildSystemPrompt, buildConversationPrompt } from './prompt'
import { NODE_CATALOG } from './catalog'
import { planTasks } from '../batch/plan'

describe('DSL → キャンバス', () => {
  it('切り抜き → 白背景 → 書き出し: ハンドル・配置・計画', () => {
    const r = compileWorkflow({
      name: '背景処理',
      nodes: [{ id: 'input', type: 'batchInput' }, { id: 'cutout', type: 'removeBackground' }, { id: 'layout', type: 'productLayout', params: { width: 1000, height: 1000, backgroundColor: '#FFFFFF' } }, { id: 'export', type: 'export' }],
      edges: [{ from: 'input.image', to: 'cutout.image' }, { from: 'cutout.cutout', to: 'layout.cutout' }, { from: 'layout.image', to: 'export.image' }, { from: 'input.item', to: 'export.item' }],
    })
    expect(r.errors).toEqual([])
    const c = r.canvas!
    expect(c.nodes.map((n) => `${n.id}:${n.type}:${n.position!.x}`)).toEqual(['input:batchInputNode:80', 'cutout:removeBackgroundNode:500', 'layout:productLayoutNode:920', 'export:exportNode:1340'])
    expect(c.edges.map((e) => `${e.source}.${e.sourceHandle}→${e.target}.${e.targetHandle}`)).toEqual(['input.out-image-image→cutout.in-image-image', 'cutout.out-cutout-cutout→layout.in-cutout-cutout', 'layout.out-image-image→export.in-image-0', 'input.out-item-item→export.in-item-item'])
    expect(c.nodes[2].data.params).toMatchObject({ width: 1000, height: 1000, backgroundColor: '#FFFFFF', variantName: 'ec_white' })
    expect(planTasks(c).tasks.map((t) => t.kind)).toEqual(['cutout'])
    expect(r.notes).toEqual([])
  })
  it('試着の一括: Try-On の注意が付く。複数の画像を export に → スロットが増える', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'in', type: 'batchInput' }, { id: 't', type: 'tryOn', params: { role: 'front' } }, { id: 'ex', type: 'export' }],
      edges: [{ from: 'in.image', to: 't.garment' }, { from: 't.image', to: 'ex.image' }, { from: 'in.image', to: 'ex.image' }, { from: 'in.item', to: 'ex.item' }],
    })
    expect(r.errors).toEqual([])
    expect(r.canvas!.edges.filter((e) => e.target === 'ex').map((e) => e.targetHandle)).toEqual(['in-image-0', 'in-image-1', 'in-item-item'])
    expect(r.notes.some((n) => n.includes('モデルの画像が無い'))).toBe(true)   // モデル未選択なので計画の注意
    expect(r.notes.some((n) => n.includes('モデル入力に Model ノード'))).toBe(true)
    expect(r.canvas!.nodes.map((n) => n.data.label)).toEqual(['Batch Input', 'Try-On', 'Export'])   // 名前は種類名のまま
  })
  it('Model ノード → Try-On、Try-On の結果 → Video Generation の始点・終点: 回転の定型文が欄に入り、autoTurn は false', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'gf', type: 'referenceImage', params: { role: 'front' } }, { id: 'gr', type: 'referenceImage', params: { role: 'right' } }, { id: 'm', type: 'libraryModel' }, { id: 'tf', type: 'tryOn', params: { role: 'front' } }, { id: 'tr', type: 'tryOn', params: { role: 'right' } }, { id: 'v', type: 'videoGen', params: { prompt: 'ゆっくり' } }],
      edges: [{ from: 'gf.image', to: 'tf.garment' }, { from: 'm.front', to: 'tf.model' }, { from: 'gr.image', to: 'tr.garment' }, { from: 'm.right', to: 'tr.model' }, { from: 'tf.image', to: 'v.start' }, { from: 'tr.image', to: 'v.end' }],
    })
    expect(r.errors).toEqual([])
    const v = r.canvas!.nodes.find((n) => n.id === 'v')!
    expect(v.data.params).toMatchObject({ autoTurn: false, negativePrompt: expect.stringContaining('背中を見せる') })
    expect(String(v.data.params.prompt)).toMatch(/^正面を向いたまま[\s\S]*\nゆっくり$/)
    expect(r.canvas!.edges.filter((e) => e.target === 'tf').map((e) => `${e.source}.${e.sourceHandle}→${e.targetHandle}`)).toEqual(['gf.out-image→in-image-garment', 'm.out-image-front→in-image-model'])
    expect(r.notes.some((n) => n.includes('Model ノードでライブラリのモデルを選んで'))).toBe(true)
  })
  it('種別・ポート・相性・本数の誤りは errors（キャンバスは作らない）', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'a', type: 'batchInput' }, { id: 'b', type: 'removeBackground' }, { id: 'v', type: 'videoGen' }, { id: 'x', type: 'nope' }],
      edges: [{ from: 'a.image', to: 'b.photo' }, { from: 'b.cutout', to: 'v.start' }, { from: 'a.image', to: 'b.image' }, { from: 'a.image', to: 'b.image' }, { from: 'bad', to: 'b.image' }],
    })
    expect(r.canvas).toBeNull()
    expect(r.errors).toEqual([
      'ノード x: 種別 "nope" はありません',
      '辺 a.image → b.photo: removeBackground に入力ポート "photo" はありません（image）',
      '辺 b.cutout → v.start: cutout の出力は videoGen.start（image）につなげません',
      '辺 a.image → b.image: removeBackground.image にはこれ以上つなげません',
      '辺 bad → b.image: "ノードid.ポート名" の形にしてください',
    ])
  })
  it('結合の順と動画の段', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'in', type: 'batchInput' }, { id: 'rr', type: 'referenceImage', params: { role: 'right' } }, { id: 'tp', type: 'textPrompt', params: { prompt: 'p' } }, { id: 's1', type: 'videoGen' }, { id: 's2', type: 'videoGen' }, { id: 'm', type: 'videoMerge' }],
      edges: [{ from: 'in.image', to: 's1.start' }, { from: 'rr.image', to: 's1.end' }, { from: 'in.image', to: 's2.start' }, { from: 'tp.text', to: 's1.text' }, { from: 'tp.text', to: 's2.text' }, { from: 's1.video', to: 'm.video' }, { from: 's2.video', to: 'm.video' }],
    })
    expect(r.errors).toEqual([])
    expect(r.canvas!.edges.filter((e) => e.target === 'm').map((e) => e.targetHandle)).toEqual(['in-video-1', 'in-video-2'])
    expect(r.canvas!.nodes.find((n) => n.id === 'm')!.position!.x).toBe(80 + 2 * 420)
    expect(planTasks(r.canvas!).tasks.map((t) => `${t.nodeId}:${t.kind}`)).toEqual(['s1:videoShot', 's2:videoShot', 'm:videoMerge'])
  })
})

describe('LLM の応答の読み取りとプロンプト', () => {
  it('コードフェンス付きでも読め、形が違えば error', () => {
    expect(parseAgentReply('```json\n{"message":"ok","workflow":{"name":"n","nodes":[{"id":"a","type":"batchInput"}],"edges":[]}}\n```').reply).toEqual({ message: 'ok', workflow: { name: 'n', nodes: [{ id: 'a', type: 'batchInput' }], edges: [] } })
    expect(parseAgentReply('{"questions":["何枚ですか？"]}').reply).toEqual({ questions: ['何枚ですか？'] })
    expect(parseAgentReply('hello').error).toMatch(/JSON/)
    expect(parseAgentReply('{"workflow":{"nodes":[{"id":1}],"edges":[]}}').error).toMatch(/id \/ type/)
  })
  it('システムプロンプトに全ノード種別と規則が入り、会話は役割付きで並ぶ', () => {
    const s = buildSystemPrompt()
    for (const n of NODE_CATALOG) expect(s).toContain(`"type":"${n.type}"`)
    expect(s).toContain('2 段まで')
    expect(buildConversationPrompt([{ role: 'user', content: 'a' }, { role: 'assistant', content: '{}' }], '直して')).toBe('ユーザー: a\nアシスタント: {}\nユーザー: 直して\nアシスタント:')
  })
})

describe('チャットの構成: 名前は種類名のまま・LLM の label は添え書き・2 段の注意', () => {
  it('label は hints に入り、ノード名は種類名。切り抜き → 試着は 2 段の注意が付く', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'in', type: 'batchInput', label: '商品写真（服）' }, { id: 'rb', type: 'removeBackground', label: '切り抜き' }, { id: 'm', type: 'libraryModel' }, { id: 't', type: 'tryOn', label: '試着 正面', params: { role: 'front' } }],
      edges: [{ from: 'in.image', to: 'rb.image' }, { from: 'rb.cutout', to: 't.garment' }, { from: 'm.front', to: 't.model' }],
    })
    expect(r.errors).toEqual([])
    expect(r.canvas!.nodes.map((n) => n.data.label)).toEqual(['Batch Input', 'Remove Background', 'Model', 'Try-On'])
    expect(r.hints).toEqual({ in: '商品写真（服）', rb: '切り抜き', t: '試着 正面' })
    expect(r.notes.some((n) => n.includes('AI 処理が 2 段'))).toBe(false)   // モデル未選択なので試着は対象外（2 段の注意はモデルが入ってから）
    expect(buildSystemPrompt()).toContain('Remove Background は、ユーザーが背景処理')
  })
})
