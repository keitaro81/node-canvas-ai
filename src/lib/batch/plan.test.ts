import { describe, it, expect } from 'vitest'
import { entryNodeOf, imageRoleOfSource, inputNodesOf, materializeTurnPresets, planTasks, planTasksForNode, pruneToEntry, promptTextsToTranslateForPlan, snapshotHasVideo, type WorkflowSnapshot, videoPromptOf, videoPromptSources } from './plan'
import { NEG_JP_NO_BACK, TO_END_EN, turnInstruction, turnPreset } from '../video/productVideo'

const RB_PARAMS = { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '1024x1024', alphaThreshold: 8, featherPx: 0 }
const bi = { id: 'bi', data: { type: 'batchInput', params: {} } }
const tp = (id: string, prompt: string) => ({ id, data: { type: 'textPrompt', params: { prompt } } })
const rb = (id: string) => ({ id, data: { type: 'removeBackground', params: RB_PARAMS } })
const vg = (id: string, data: Record<string, unknown> = {}) => ({ id, type: 'videoGenerationNode', data: { label: id, model: 'kling-v3-pro', duration: '3', resolution: '1080p', aspectRatio: 'auto', fps: 25, audioEnabled: false, seed: null, params: {}, ...data } })
const merge = (id: string) => ({ id, data: { type: 'videoMerge', label: id, params: {} } })
const e = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })
const ids = (snap: WorkflowSnapshot) => planTasks(snap).tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}`)

describe('planTasks: Batch Input → Video Generation → Video Merge（写真ごとの動画）', () => {
  const snap: WorkflowSnapshot = {
    nodes: [bi, tp('tp', 'studio'), vg('v1'), merge('m')],
    edges: [e('bi', 'out-image-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text'), e('v1', 'out-video', 'm', 'in-video-1')],
  }
  it('ショットは 1 段目・結合は前段 + 1（AI 段には数えない）。入力は参照表、終端は結合だけ', () => {
    const { tasks, warnings } = planTasks(snap)
    expect(warnings).toEqual([])
    expect(ids(snap)).toEqual(['v1:videoShot:1', 'm:videoMerge:2'])
    const [v, m] = tasks
    expect(v.endpoint).toBe('fal-ai/kling-video/v3/pro/image-to-video')
    expect(v.input).toMatchObject({ prompt: 'studio', duration: '3', generate_audio: false, __shot: { index: 0, role: null, endRole: null, duration: 3 } })
    expect('start_image_url' in v.input).toBe(false)
    expect(v.inputs).toEqual({ start: { kind: 'photo' } })
    expect(v.video).toMatchObject({ modelId: 'kling-v3-pro', startParam: 'start_image_url', endParam: 'end_image_url', elements: false, aspectAuto: false })
    expect(v.terminal).toBe(false)
    expect(v.dependsOn).toBeNull()
    expect(m).toMatchObject({ endpoint: 'fal-ai/ffmpeg-api/merge-videos', dependsOn: 'v1', inputs: { videos: ['v1'] }, terminal: true, label: 'm' })
    expect(snapshotHasVideo(snap)).toBe(true)
    expect(inputNodesOf(snap)).toEqual({ batchInputId: 'bi' })
  })
  it('結合が無ければショットが終端', () => {
    const { tasks } = planTasks({ nodes: [bi, tp('tp', 'p'), vg('v1')], edges: [e('bi', 'out-image-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text')] })
    expect(tasks.map((t) => [t.nodeId, t.terminal])).toEqual([['v1', true]])
  })
  it('プロンプトが空の Video Generation は対象外、その結合も対象外', () => {
    const { tasks, warnings } = planTasks({ nodes: [bi, vg('v1'), merge('m')], edges: [e('bi', 'out-image-image', 'v1', 'in-image'), e('v1', 'out-video', 'm', 'in-video-1')] })
    expect(tasks).toEqual([])
    expect(warnings.some((w) => w.includes('v1') && w.includes('プロンプトが空'))).toBe(true)
    expect(warnings.some((w) => w.includes('結合も対象外'))).toBe(true)
  })
  it('参照動画が要るモデルは対象外', () => {
    const { tasks, warnings } = planTasks({ nodes: [bi, tp('tp', 'p'), vg('v1', { model: 'kling-o3-pro-v2v' })], edges: [e('bi', 'out-image-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text')] })
    expect(tasks).toEqual([])
    expect(warnings.some((w) => w.includes('画像から動画を作れない'))).toBe(true)
  })
  it('他のモデル: LTX は整数の秒数・解像度・fps、Kling 2.5 は比率を投入時にアイテムの寸法から決める', () => {
    const base = { nodes: [bi, tp('tp', 'p'), vg('v1', { model: 'ltx-2.3-fast', duration: '6' })], edges: [e('bi', 'out-image-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text')] }
    const ltx = planTasks(base).tasks[0]
    expect(ltx.endpoint).toBe('fal-ai/ltx-2.3/image-to-video/fast')
    expect(ltx.input).toEqual({ prompt: 'p', duration: 6, resolution: '1080p', fps: 25, generate_audio: false, __shot: { index: 0, role: null, endRole: null, duration: 6 } })
    expect(ltx.video).toMatchObject({ startParam: 'image_url', endParam: null, aspectAuto: false })
    const k = planTasks({ ...base, nodes: [bi, tp('tp', 'p'), vg('v1', { model: 'kling-2.5-turbo', duration: '5' })] }).tasks[0]
    expect(k.endpoint).toBe('fal-ai/kling-video/v2.5-turbo/pro/image-to-video')
    expect(k.video).toMatchObject({ startParam: 'image_url', endParam: 'tail_image_url', aspectAuto: true, aspectRatios: ['16:9', '9:16', '1:1'] })
    expect('aspect_ratio' in k.input).toBe(false)
  })
})

describe('planTasks: 動画があるジョブは動画だけ（2026-10-31 決定）と段の数え方', () => {
  const pl = { id: 'pl', data: { type: 'productLayout', params: {} } }
  it('動画につながらない切り抜き（Product Layout 向け）は対象外にして注意を出す', () => {
    const { tasks, warnings, droppedForVideo } = planTasks({
      nodes: [bi, rb('rb'), pl, tp('tp', 'p'), vg('v1')],
      edges: [e('bi', 'out-image-image', 'rb', 'in-image-image'), e('rb', 'out-cutout-cutout', 'pl', 'in-cutout-cutout'), e('bi', 'out-image-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text')],
    })
    expect(tasks.map((t) => t.nodeId)).toEqual(['v1'])
    expect(warnings).toContain('この構成では動画だけを処理します（Remove Background の画像は作りません）')
    expect(warnings).toContain('この構成では Product Layout の画像は作りません（動画だけを処理します）')
    expect(droppedForVideo.map((t) => t.nodeId)).toEqual(['rb'])   // App の「画像と動画の混在」の判定に使う（2026-11-02）
  })
  it('切り抜き → 動画: 切り抜きは動画の前段として動き、透過画像を開始フレームにする（両出力）。結合は AI 段に数えない', () => {
    const { tasks, warnings } = planTasks({
      nodes: [bi, rb('rb'), tp('tp', 'p'), vg('v1'), merge('m')],
      edges: [e('bi', 'out-image-image', 'rb', 'in-image-image'), e('rb', 'out-cutout-cutout', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text'), e('v1', 'out-video', 'm', 'in-video-1')],
    })
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.stage}:${t.dependsOn ?? '-'}`)).toEqual(['rb:1:-', 'v1:2:rb', 'm:3:v1'])
    expect(tasks[0].dualOutput).toBe(true)
    expect(tasks[0].input.mask_only).toBe(false)
    expect(tasks[1].inputs.start).toEqual({ kind: 'dep', nodeId: 'rb', prefer: 'cutout' })
  })
  it('レタッチ → 切り抜き → 動画 は 3 段目で対象外（結合も）', () => {
    const { tasks, warnings } = planTasks({
      nodes: [bi, tp('tp', 'p'), { id: 'gen', data: { type: 'imageGen', label: 'レタッチ', params: {} } }, rb('rb'), vg('v1'), merge('m')],
      edges: [e('bi', 'out-image-image', 'gen', 'in-image-1'), e('tp', 'out-text-text-out', 'gen', 'in-text'), e('gen', 'out-image-image-out', 'rb', 'in-image-image'), e('rb', 'out-cutout-cutout', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text'), e('v1', 'out-video', 'm', 'in-video-1')],
    })
    expect(tasks.map((t) => t.nodeId)).toEqual(['gen', 'rb'])
    expect(warnings.some((w) => w.includes('v1 は 3 段目'))).toBe(true)
    expect(warnings.some((w) => w.includes('結合も対象外'))).toBe(true)
  })
})

describe('planTasks: Try-On（2b-3・写真ごとの試着）', () => {
  const MODEL = 'https://x.supabase.co/storage/v1/object/public/generated-images/library/u/m.jpg'
  const GARMENT = 'https://x.supabase.co/storage/v1/object/public/generated-images/ri/g.jpg'
  const tryOn = (id: string, data: Record<string, unknown> = {}) => ({ id, type: 'tryOnNode', data: { type: 'tryOn', label: id, params: { resolution: '2K', note: '' }, model: { url: MODEL, role: 'front', itemId: 'm' }, ...data } })
  const ri = { id: 'ri', type: 'referenceImageNode', data: { type: 'referenceImage', output: GARMENT } }
  it('Batch Input の写真 × ノードで選んだモデル（固定の画像）= 画像編集の 1 段目。入力は服（写真）とモデル（asset）で、英訳した補足が既定文の末尾に付く', () => {
    const { tasks, warnings } = planTasks({ nodes: [bi, tryOn('t1', { params: { resolution: '1K', note: 'ニットカーディガン' } })], edges: [e('bi', 'out-image-image', 't1', 'in-image-garment')], promptTranslations: { 'ニットカーディガン': 'A knit cardigan.' } })
    expect(warnings).toEqual([])
    expect(tasks).toHaveLength(1)
    const t = tasks[0]
    expect(t).toMatchObject({ nodeId: 't1', kind: 'imageEdit', stage: 1, endpoint: 'google/nano-banana-2.1/edit', dependsOn: null, inputs: { image: { kind: 'photo' }, model: { kind: 'asset', url: MODEL } } })
    expect(t.input).toMatchObject({ resolution: '1K', aspect_ratio: 'auto' })
    expect(String(t.input.prompt)).toMatch(/^Virtual try-on\. Put ONLY/)
    expect(String(t.input.prompt)).toMatch(/A knit cardigan\.$/)
    expect('image_urls' in t.input).toBe(false)
  })
  it('英訳が要る文に服の説明・補足が含まれる（英語や空は含まない）', () => {
    expect(promptTextsToTranslateForPlan({ nodes: [bi, tryOn('t1', { params: { note: '黒いジャケット' } })], edges: [e('bi', 'out-image-image', 't1', 'in-image-garment')] })).toEqual(['黒いジャケット'])
    expect(promptTextsToTranslateForPlan({ nodes: [bi, tryOn('t1', { params: { note: 'Black jacket' } })], edges: [e('bi', 'out-image-image', 't1', 'in-image-garment')] })).toEqual([])
  })
  it('切り抜き → 試着 は 2 段目で透過画像を受け、切り抜きはマスクと透過画像の両方を保存する', () => {
    const { tasks, warnings } = planTasks({ nodes: [bi, rb('rb'), tryOn('t1')], edges: [e('bi', 'out-image-image', 'rb', 'in-image-image'), e('rb', 'out-cutout-cutout', 't1', 'in-image-garment')] })
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}`)).toEqual(['rb:cutout:1', 't1:imageEdit:2'])
    expect(tasks[1]).toMatchObject({ dependsOn: 'rb', inputs: { image: { kind: 'dep', nodeId: 'rb', prefer: 'cutout' }, model: { kind: 'asset', url: MODEL } } })
    expect(tasks[0].dualOutput).toBe(true)
  })
  it('試着 → Video Generation（結果ノード経由）は試着の結果を始点にする 2 段目。動画のジョブでも試着は動画につながるので残る', () => {
    const snap: WorkflowSnapshot = {
      nodes: [bi, tryOn('t1'), { id: 'disp', type: 'imageDisplayNode', data: { type: 'imageDisplay' } }, tp('tp', 'p'), vg('v1')],
      edges: [e('bi', 'out-image-image', 't1', 'in-image-garment'), e('t1', 'out-image-image-out', 'disp', 'in-image-image-in'), e('disp', 'out-image-image-out', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text')],
    }
    const { tasks, warnings } = planTasks(snap)
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}`)).toEqual(['t1:imageEdit:1', 'v1:videoShot:2'])
    expect(tasks[1]).toMatchObject({ dependsOn: 't1', inputs: { start: { kind: 'dep', nodeId: 't1', prefer: 'result' } }, terminal: true })
    expect(snapshotHasVideo(snap)).toBe(true)
  })
  it('固定の服（参照画像）× Batch Input のモデル写真 でも作れる（逆の使い方）', () => {
    const { tasks, warnings } = planTasks({ nodes: [bi, ri, tryOn('t1', { model: null })], edges: [e('ri', 'out-image', 't1', 'in-image-garment'), e('bi', 'out-image-image', 't1', 'in-image-model')] })
    expect(warnings).toEqual([])
    expect(tasks[0]).toMatchObject({ kind: 'imageEdit', inputs: { image: { kind: 'asset', url: GARMENT }, model: { kind: 'photo' } } })
  })
  it('Model ノードをつないであるがモデル未選択の Try-On は「まだ処理できません」で外し、後段と一緒に pendingModel に入る。選べば計画に入る（2026-11-07 メモ 68）', () => {
    const lm = (cuts: Record<string, unknown>) => ({ id: 'lm', type: 'libraryModelNode', data: { type: 'libraryModel', label: 'Model', modelId: null, cuts } })
    const ig = { id: 'ig', type: 'imageGenerationNode', data: { type: 'imageGen', label: 'ig', params: { prompt: 'NY', executionScope: 'item' } } }
    const edges = [e('bi', 'out-image-image', 't1', 'in-image-garment'), e('lm', 'out-image-front', 't1', 'in-image-model'), e('t1', 'out-image-image-out', 'ig', 'in-image')]
    const r = planTasks({ nodes: [bi, lm({}), tryOn('t1', { model: null }), ig], edges })
    expect(r.tasks).toEqual([])
    expect(r.excluded.t1).toContain('モデルが選ばれていないため、まだ処理できません')
    expect(r.excluded.ig).toContain('前段（t1）')
    expect(r.pendingModel).toEqual(['t1', 'ig'])
    const ok = planTasks({ nodes: [bi, lm({ front: { url: MODEL, itemId: 'm' } }), tryOn('t1', { model: null }), ig], edges })
    expect(ok.tasks.map((t) => t.nodeId)).toEqual(['t1', 'ig'])
    expect(ok.pendingModel).toEqual([])
  })
  it('モデルが無い / 服がつながっていない Try-On は注意を出して対象外。両方が固定の画像なら対話実行だけ（注意なし）', () => {
    const noModel = planTasks({ nodes: [bi, tryOn('t1', { model: null })], edges: [e('bi', 'out-image-image', 't1', 'in-image-garment')] })
    expect(noModel.tasks).toEqual([])
    expect(noModel.warnings).toEqual(['Try-On（t1）はモデルの画像が無いため一括実行の対象外です（Model ノードをつなぐか、参照画像のモデルタブから入れてください）'])
    expect(noModel.excluded).toEqual({ t1: noModel.warnings[0] })
    const noGarment = planTasks({ nodes: [bi, tryOn('t1', { model: null })], edges: [e('bi', 'out-image-image', 't1', 'in-image-model')] })
    expect(noGarment.tasks).toEqual([])
    expect(noGarment.warnings).toEqual(['Try-On（t1）は服の画像がつながっていないため一括実行の対象外です'])
    const fixed = planTasks({ nodes: [bi, ri, tryOn('t1')], edges: [e('ri', 'out-image', 't1', 'in-image-garment')] })
    expect(fixed.tasks).toEqual([])
    expect(fixed.warnings).toEqual([])
  })
})

describe('2b-4: Try-On の向きを Video Generation の始点・終点に引き継ぐ', () => {
  const MODEL = (role: string) => `https://x.supabase.co/storage/v1/object/public/generated-images/library/u/${role}.jpg`
  const tryOn = (id: string, role: string, data: Record<string, unknown> = {}) => ({ id, type: 'tryOnNode', data: { type: 'tryOn', label: id, params: { resolution: '2K', note: '' }, model: { url: MODEL(role), role, itemId: role }, ...data } })
  it('試着（正面）→ 始点、試着（右側面）→ 終点: 参照に向きが載り、ショットの見出しと回転指示に使う', () => {
    const snap: WorkflowSnapshot = {
      nodes: [bi, tryOn('tf', 'front'), tryOn('tr', 'right'), tp('tp', 'p'), vg('v1'), merge('m')],
      edges: [e('bi', 'out-image-image', 'tf', 'in-image-garment'), e('bi', 'out-image-image', 'tr', 'in-image-garment'), e('tf', 'out-image-image-out', 'v1', 'in-image'), e('tr', 'out-image-image-out', 'v1', 'in-image-end'), e('tp', 'out-text-text-out', 'v1', 'in-text'), e('v1', 'out-video', 'm', 'in-video-1')],
    }
    const { tasks, warnings } = planTasks(snap)
    expect(warnings).toEqual([])
    expect(ids(snap)).toEqual(['tf:imageEdit:1', 'tr:imageEdit:1', 'v1:videoShot:2', 'm:videoMerge:3'])
    const v = tasks.find((t) => t.nodeId === 'v1')!
    expect(v.inputs).toEqual({ start: { kind: 'dep', nodeId: 'tf', prefer: 'result', role: 'front' }, end: { kind: 'dep', nodeId: 'tr', prefer: 'result', role: 'right' } })
    expect(v.dependsOn).toEqual(['tf', 'tr'])
    expect(v.input.__shot).toMatchObject({ role: 'front', endRole: 'right' })
    expect(v.input.prompt).toBe('p')   // 回転の指示は裏で足さない（欄の文だけ・2026-11-01 決定）。向きは __shot と表示に使う
    expect(v.input.cfg_scale).toBe(0.7)
  })
  it('画像の出どころの向き: Model の向きのポート / Try-On（選んだカット・Model から・別の Try-On から）/ Try-On の結果ノード。参照画像の向きは読まない（2026-11-02 メモ 42）。それ以外は null', () => {
    const nodes = [{ id: 'mdl', type: 'libraryModelNode', data: { type: 'libraryModel', cuts: {} } }, { id: 'ri2', type: 'referenceImageNode', data: { type: 'referenceImage', role: 'back' } }, tryOn('t1', 'back'), tryOn('t2', 'front', { model: null }), tryOn('t3', 'left', { model: null }), { id: 'disp', type: 'imageDisplayNode', data: { type: 'imageDisplay' } }, { id: 'ri', type: 'referenceImageNode', data: { type: 'referenceImage' } }]
    const edges = [e('mdl', 'out-image-right', 't2', 'in-image-model'), e('t2', 'out-image-image-out', 't3', 'in-image-model'), e('t1', 'out-image-image-out', 'disp', 'in-image-image-in')]
    expect(imageRoleOfSource(nodes, edges, 'mdl', 'out-image-left')).toBe('left')   // Model ノードの向きのポート
    expect(imageRoleOfSource(nodes, edges, 'ri2', 'out-image')).toBeNull()   // 参照画像の向き（古いデータの role）は読まない
    expect(imageRoleOfSource(nodes, edges, 't1', 'out-image-image-out')).toBe('back')
    expect(imageRoleOfSource(nodes, edges, 't2', 'out-image-image-out')).toBe('right')
    expect(imageRoleOfSource(nodes, edges, 't3', 'out-image-image-out')).toBe('right')
    expect(imageRoleOfSource(nodes, edges, 'disp', 'out-image-image-out')).toBe('back')
    expect(imageRoleOfSource(nodes, edges, 'ri', 'out-image')).toBeNull()
  })
})
describe('materializeTurnPresets（トグル廃止・読み込み時 / 組んだ直後に回転の定型文を欄に）', () => {
  const ref = (id: string, role: string | null) => ({ id, type: 'referenceImageNode', data: { type: 'referenceImage', imageUrl: `https://x/${id}.jpg`, role } })
  it('autoTurn 未設定の VG: 向きが違えば定型文を動き・避けたいことに入れて autoTurn: false。同じ向きなら autoTurn だけ。向きが分からない / autoTurn: false はそのまま', () => {
    const nodes = [ref('rf', 'front'), ref('rr', 'right'), ref('rk', 'back'), vg('v1', { params: { prompt: 'Feet stay planted.', negativePrompt: 'blur' } }), vg('v2', { params: { prompt: '呼吸する' } }), vg('v3', { params: {} }), vg('v4', { params: { autoTurn: false, prompt: 'x' } })]
    const edges = [e('rf', 'out-image', 'v1', 'in-image'), e('rr', 'out-image', 'v1', 'in-image-end'), e('rk', 'out-image', 'v2', 'in-image'), e('rk', 'out-image', 'v2', 'in-image-end'), e('rf', 'out-image', 'v4', 'in-image'), e('rr', 'out-image', 'v4', 'in-image-end')]
    expect(materializeTurnPresets(nodes, edges).written).toBe(0)   // 参照画像の向き（古い role）は読まない（2026-11-02 メモ 42）
    const r = materializeTurnPresets(nodes, edges, { rf: 'front', rr: 'right', rk: 'back' })   // チャットで組むときだけの向き
    expect(r.changed).toBe(true)
    expect(r.written).toBe(1)
    const [, , , v1, v2, v3, v4] = r.nodes
    expect(v1.data.params).toEqual({ prompt: `${turnPreset('front', 'right').motion}\nFeet stay planted.`, negativePrompt: `blur、${NEG_JP_NO_BACK}`, autoTurn: false })
    expect(v2.data.params).toEqual({ prompt: '呼吸する', autoTurn: false })
    expect(v3).toBe(nodes[5])
    expect(v4).toBe(nodes[6])
    expect(materializeTurnPresets(r.nodes, edges).changed).toBe(false)
    // 書き込む前は欄の文だけ（裏で足さない）。書き込んだ後は定型文の対訳（行ごと）+ 補足 + 最短で終点へ
    const inputs = { start: { kind: 'photo' as const }, end: { kind: 'photo' as const } }
    expect(videoPromptOf(nodes, edges, nodes[3], inputs, null).prompt).toBe('Feet stay planted.')
    const after = videoPromptOf(r.nodes, edges, r.nodes[3], inputs, null)
    expect(after.prompt).toContain(turnInstruction('front', 'right').motion)
    expect(after.prompt).toContain('Feet stay planted.')
    expect(after.prompt).toContain(TO_END_EN)
    expect(after.turned).toBe(true)
    expect(videoPromptSources(r.nodes, edges, 'v1')).toEqual([turnPreset('front', 'right').motion, 'Feet stay planted.', `blur、${NEG_JP_NO_BACK}`])
  })
})


describe('入口ごとの計画（メモ 24）・参照画像の固定画像（メモ 23）・固定の画像だけのノード', () => {
  const MODEL = 'https://x.supabase.co/storage/v1/object/sign/generated-images/library/u/front.jpg?token=t'
  const bi2 = { id: 'bi2', data: { type: 'batchInput', params: {} } }
  const tryOn = (id: string) => ({ id, type: 'tryOnNode', data: { type: 'tryOn', label: id, params: { resolution: '2K', note: '' }, model: null } })
  it('Batch Input が 2 つあるキャンバス: 押した入口の枝だけが対象になり、ノードの注意も自分の入口で決まる', () => {
    const riModel = { id: 'ri', type: 'referenceImageNode', data: { type: 'referenceImage', imageUrl: MODEL, role: 'front' } }
    const nodes = [bi, bi2, riModel, tryOn('t1'), tp('tp', 'p'), vg('v1'), merge('m')]
    const edges = [e('bi', 'out-image-image', 't1', 'in-image-garment'), e('ri', 'out-image', 't1', 'in-image-model'), e('bi2', 'out-image-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text'), e('v1', 'out-video', 'm', 'in-video-1')]
    const snap: WorkflowSnapshot = { nodes, edges }
    expect(planTasks(snap).tasks.map((t) => t.nodeId)).toEqual(['v1', 'm'])   // 混ぜると動画のジョブ扱いで試着は対象外
    const fromBi = planTasks(pruneToEntry(snap, 'bi'))
    expect(fromBi.tasks.map((t) => `${t.nodeId}:${t.kind}`)).toEqual(['t1:imageEdit'])
    expect(fromBi.tasks[0].inputs.model).toEqual({ kind: 'asset', url: MODEL })   // 参照画像 = 固定の画像（向きは持たない・メモ 42）。生データの imageUrl でも読める
    expect(planTasks(pruneToEntry(snap, 'bi2')).tasks.map((t) => t.nodeId)).toEqual(['v1', 'm'])
    expect(entryNodeOf(snap, 't1')).toBe('bi')
    expect(entryNodeOf(snap, 'm')).toBe('bi2')
    expect(entryNodeOf(snap, 'ri')).toBeNull()
    expect(planTasksForNode(snap, 't1').tasks.map((t) => t.nodeId)).toEqual(['t1'])
    expect(inputNodesOf(pruneToEntry(snap, 'bi'))).toEqual({ batchInputId: 'bi' })
    const single: WorkflowSnapshot = { nodes: [bi, riModel, tryOn('t1')], edges: edges.slice(0, 2) }
    expect(pruneToEntry(single, 'bi')).toBe(single)
  })
  it('固定の画像（参照画像）だけを入力にした Remove Background / Image Generation / Video Generation は一括の対象にしない。写真と組み合わせれば対象（参照画像の向きは載らない）', () => {
    const ri = { id: 'ri', type: 'referenceImageNode', data: { type: 'referenceImage', output: 'https://x/g.jpg', role: 'front' } }
    const gen = { id: 'gen', data: { type: 'imageGen', label: 'gen', params: { model: 'fal-ai/nano-banana-2' } } }
    const snap: WorkflowSnapshot = {
      nodes: [bi, ri, rb('rb1'), tp('tp', 'p'), gen, vg('v1'), vg('v2')],
      edges: [e('ri', 'out-image', 'rb1', 'in-image-image'), e('ri', 'out-image', 'gen', 'in-image'), e('tp', 'out-text-text-out', 'gen', 'in-text'), e('ri', 'out-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text'),
        e('ri', 'out-image', 'v2', 'in-image'), e('bi', 'out-image-image', 'v2', 'in-image-end'), e('tp', 'out-text-text-out', 'v2', 'in-text')],
    }
    const { tasks, excluded } = planTasks(snap)
    expect(tasks.map((t) => t.nodeId)).toEqual(['v2'])
    expect(tasks[0].inputs).toEqual({ start: { kind: 'asset', url: 'https://x/g.jpg' }, end: { kind: 'photo' } })
    expect(tasks[0].input.__shot).toMatchObject({ role: null, endRole: null })
    expect(Object.keys(excluded)).toContain('rb1')
  })
})
