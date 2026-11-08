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
    // 一括の構成は最初からグループ＋App 化（2026-11-02）: 子の位置はグループ（x = 80 - 40）からの相対
    expect(c.nodes.map((n) => `${n.id}:${n.type}:${n.position!.x}`)).toEqual(['app-group:groupNode:40', 'input:batchInputNode:40', 'cutout:removeBackgroundNode:460', 'layout:productLayoutNode:880', 'export:exportNode:1300'])
    expect(c.capsuleGroupId).toBe('app-group')
    expect(c.edges.map((e) => `${e.source}.${e.sourceHandle}→${e.target}.${e.targetHandle}`)).toEqual(['input.out-image-image→cutout.in-image-image', 'cutout.out-cutout-cutout→layout.in-cutout-cutout', 'layout.out-image-image→export.in-image-0', 'input.out-item-item→export.in-item-item'])
    expect(c.nodes[3].data.params).toMatchObject({ width: 1000, height: 1000, backgroundColor: '#FFFFFF', variantName: 'ec_white' })
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
    expect(r.canvas!.nodes.map((n) => n.data.label)).toEqual(['Group', 'Batch Input', 'Try-On', 'Export'])   // 名前は種類名のまま（先頭は App 化したグループ）
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
    expect(r.canvas!.nodes.find((n) => n.id === 'm')!.position!.x).toBe(80 + 2 * 420 - 40)   // グループからの相対位置
    expect(planTasks(r.canvas!).tasks.map((t) => `${t.nodeId}:${t.kind}`)).toEqual(['s1:videoShot', 's2:videoShot', 'm:videoMerge'])
  })
})

describe('チャットで組む: 参照画像の向きは組むときだけ・Kling Element（2026-11-02 メモ 42）', () => {
  it('role は案内（photoHint）と回転の指示文にだけ使い、ノードに向きは残さない。参照一式をつないだショットは動きの先頭に @Element1', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'rf', type: 'referenceImage', params: { role: 'front' } }, { id: 'rr', type: 'referenceImage', params: { role: 'right' } }, { id: 'tp', type: 'textPrompt', params: { prompt: 'p' } }, { id: 'el', type: 'klingElement' }, { id: 'v', type: 'videoGen', params: { prompt: 'ゆっくり' } }],
      edges: [{ from: 'rf.image', to: 'v.start' }, { from: 'rr.image', to: 'v.end' }, { from: 'tp.text', to: 'v.text' }, { from: 'rf.image', to: 'el.frontal' }, { from: 'rr.image', to: 'el.ref1' }, { from: 'el.element', to: 'v.element1' }],
    })
    expect(r.errors).toEqual([])
    const ri = r.canvas!.nodes.find((n) => n.id === 'rf')!
    expect(ri.data.role).toBeUndefined()
    expect(ri.data.photoHint).toBe('正面')
    const v = r.canvas!.nodes.find((n) => n.id === 'v')!
    const prompt = String(v.data.params.prompt)
    expect(prompt.startsWith('@Element1\n')).toBe(true)
    expect(prompt).toContain('4 分の 1 回転')   // 正面 → 右側面の回転の指示文（組むときの向きから）
    expect(prompt).toContain('ゆっくり')
    expect(r.canvas!.edges.find((e) => e.target === 'v' && e.targetHandle === 'in-element-1')?.source).toBe('el')
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
    expect(r.canvas!.nodes.map((n) => n.data.label)).toEqual(['Group', 'Batch Input', 'Remove Background', 'Model', 'Try-On'])
    expect(r.hints).toEqual({ in: '商品写真（服）', rb: '切り抜き', t: '試着 正面' })
    expect(r.notes.some((n) => n.includes('AI 処理が 2 段'))).toBe(false)   // モデル未選択なので試着は対象外（2 段の注意はモデルが入ってから）
    expect(buildSystemPrompt()).toContain('Remove Background は、ユーザーが背景処理')
  })
})

describe('チャットで組む: 書き出しは一括か結合があるときだけ（2026-11-08 メモ 78）', () => {
  it('Batch Input の無い構成に付いた export は外して注意に添える。辺も消え、配置はほかのノードだけ', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'ri', type: 'referenceImage' }, { id: 'tp', type: 'textPrompt' }, { id: 'ig', type: 'imageGen' }, { id: 'm', type: 'libraryModel' }, { id: 't', type: 'tryOn' }, { id: 'ex', type: 'export', label: '書き出し' }],
      edges: [{ from: 'ri.image', to: 'ig.image' }, { from: 'tp.text', to: 'ig.text' }, { from: 'ig.image', to: 't.garment' }, { from: 'm.front', to: 't.model' }, { from: 't.image', to: 'ex.image' }],
    })
    expect(r.errors).toEqual([])
    // Image Generation の出力は Result 経由（2026-11-08 メモ 81）: Result は Image Generation の次の列、Try-On はその次
    expect(r.canvas!.nodes.map((n) => `${n.id}:${n.type}:${n.position!.x}`)).toEqual(['ri:referenceImageNode:80', 'tp:textPromptNode:80', 'ig:imageGenerationNode:500', 'ig-result:imageDisplayNode:920', 'm:libraryModelNode:80', 't:tryOnNode:1340'])
    expect(r.canvas!.nodes.find((n) => n.id === 'ig-result')!.data).toEqual({ type: 'imageDisplay', label: 'Result', params: {}, status: 'idle', output: undefined })
    expect(r.canvas!.edges.filter((e) => e.target === 't' || e.target === 'ig-result').map((e) => `${e.source}.${e.sourceHandle}→${e.target}.${e.targetHandle}`).sort()).toEqual(['ig-result.out-image-image-out→t.in-image-garment', 'ig.out-image-image-out→ig-result.in-image-image-in', 'm.out-image-front→t.in-image-model'])
    expect(r.notes.some((n) => n.includes('Image Generation の結果は Result に出て'))).toBe(true)
    expect(r.canvas!.edges.some((e) => e.target === 'ex')).toBe(false)
    expect(r.hints).toEqual({})
    expect(r.notes.some((n) => n.includes('書き出し（Export）は外しました'))).toBe(true)
    expect(r.canvas!.capsuleGroupId).toBeUndefined()
  })
  it('結合（videoMerge）がある構成の export は残す。規則もプロンプトに入る', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'a', type: 'referenceVideo' }, { id: 'b', type: 'referenceVideo' }, { id: 'mg', type: 'videoMerge' }, { id: 'ex', type: 'export' }],
      edges: [{ from: 'a.video', to: 'mg.video' }, { from: 'b.video', to: 'mg.video' }, { from: 'mg.video', to: 'ex.video' }],
    })
    expect(r.errors).toEqual([])
    expect(r.canvas!.nodes.map((n) => n.id)).toContain('ex')
    expect(r.notes.some((n) => n.includes('書き出し（Export）は外しました'))).toBe(false)
    expect(buildSystemPrompt()).toContain('Batch Input の無い構成（1 枚ずつ対話で作る）には export を置かない')
  })
})

describe('チャットで組む: Image Generation の出力は Result 経由（2026-11-08 メモ 81）', () => {
  it('Image Generation → Video Generation の始点も Result 経由。一括の構成でも計画は Result を透過して 2 段になる', () => {
    const r = compileWorkflow({
      nodes: [{ id: 'in', type: 'batchInput' }, { id: 'tp', type: 'textPrompt', params: { prompt: '白背景のスタジオで' } }, { id: 'ig', type: 'imageGen' }, { id: 'v', type: 'videoGen' }, { id: 'ex', type: 'export' }],
      edges: [{ from: 'in.image', to: 'ig.image' }, { from: 'tp.text', to: 'ig.text' }, { from: 'ig.image', to: 'v.start' }, { from: 'tp.text', to: 'v.text' }, { from: 'v.video', to: 'ex.video' }, { from: 'in.item', to: 'ex.item' }],
    })
    expect(r.errors).toEqual([])
    const c = r.canvas!
    expect(c.nodes.filter((n) => n.type === 'imageDisplayNode').map((n) => n.id)).toEqual(['ig-result'])
    expect(c.edges.filter((e) => e.target === 'v').map((e) => `${e.source}.${e.sourceHandle}→${e.targetHandle}`).sort()).toEqual(['ig-result.out-image-image-out→in-image', 'tp.out-text-text-out→in-text'])
    expect(c.edges.filter((e) => e.source === 'ig').map((e) => `${e.target}.${e.targetHandle}`)).toEqual(['ig-result.in-image-image-in'])
    const { tasks } = planTasks(c)
    expect(tasks.map((t) => `${t.nodeId}:${t.stage}`)).toEqual(['ig:1', 'v:2'])
  })
  it('画像の出力をつながない Image Generation には Result を足さない。2 つの Image Generation にはそれぞれ', () => {
    const r1 = compileWorkflow({ nodes: [{ id: 'tp', type: 'textPrompt' }, { id: 'ig', type: 'imageGen' }], edges: [{ from: 'tp.text', to: 'ig.text' }] })
    expect(r1.canvas!.nodes.map((n) => n.id)).toEqual(['tp', 'ig'])
    expect(r1.notes.some((n) => n.includes('Result'))).toBe(false)
    const r2 = compileWorkflow({
      nodes: [{ id: 'tp', type: 'textPrompt' }, { id: 'a', type: 'imageGen' }, { id: 'b', type: 'imageGen' }, { id: 'm', type: 'libraryModel' }, { id: 't', type: 'tryOn' }],
      edges: [{ from: 'tp.text', to: 'a.text' }, { from: 'a.image', to: 'b.image' }, { from: 'tp.text', to: 'b.text' }, { from: 'b.image', to: 't.garment' }, { from: 'm.front', to: 't.model' }],
    })
    expect(r2.errors).toEqual([])
    expect(r2.canvas!.nodes.map((n) => n.id)).toEqual(['tp', 'a', 'a-result', 'b', 'b-result', 'm', 't'])
    expect(r2.canvas!.edges.filter((e) => e.target === 'b' || e.target === 't').map((e) => `${e.source}→${e.target}.${e.targetHandle}`).sort()).toEqual(['a-result→b.in-image', 'b-result→t.in-image-garment', 'm→t.in-image-model', 'tp→b.in-text'])
  })
})
