import { describe, it, expect } from 'vitest'
import { ELEMENT_TAG, expandProductVideo, inputNodesOf, planTasks, promptTextsToTranslateForPlan, shotsFromCanvas, snapshotHasVideo, taskMapOf, taskSatisfied, availableVideos, type WorkflowSnapshot } from './plan'

const RB_PARAMS = { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '1024x1024', alphaThreshold: 8, featherPx: 0 }
const bi = { id: 'bi', data: { type: 'batchInput', params: {} } }
const cs = { id: 'cs', data: { type: 'cutSetInput', params: {} } }
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
    expect(inputNodesOf(snap)).toEqual({ batchInputId: 'bi', cutSetInputId: null })
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

describe('planTasks: Cut Set Input → Video Generation（役割カット・カット一式・自動回転）→ Video Merge', () => {
  const snap: WorkflowSnapshot = {
    nodes: [cs, vg('v1', { params: { prompt: 'Feet stay planted.', negativePrompt: 'blur' } }), vg('v2', { params: { prompt: '振り向く' } }), merge('m')],
    edges: [
      e('cs', 'out-image-front', 'v1', 'in-image'), e('cs', 'out-image-right', 'v1', 'in-image-end'), e('cs', 'out-cuts-set', 'v1', 'in-cuts-set'),
      e('cs', 'out-image-back', 'v2', 'in-image'), e('cs', 'out-cuts-set', 'v2', 'in-cuts-set'),
      e('v1', 'out-video', 'm', 'in-video-1'), e('v2', 'out-video', 'm', 'in-video-2'),
    ],
  }
  it('始点・終点が役割カットなら回転指示と negative と cfg_scale、カット一式は elements、@Element1 を挟む', () => {
    const { tasks, warnings } = planTasks(snap)
    expect(warnings).toEqual([])
    expect(ids(snap)).toEqual(['v1:videoShot:1', 'v2:videoShot:1', 'm:videoMerge:2'])
    const [v1, v2, m] = tasks
    expect(String(v1.input.prompt)).toMatch(/^@Element1 wearing the garment\. Facing the camera, the model makes a short quarter turn/)
    expect(String(v1.input.prompt)).toContain('Feet stay planted.')
    expect(String(v1.input.prompt)).toContain('One continuous take with no cuts')
    expect(v1.input.negative_prompt).toBe('blur, back view, back to the camera, turning away from the camera')
    expect(v1.input.cfg_scale).toBe(0.7)
    expect(v1.inputs).toEqual({ start: { kind: 'cut', role: 'front' }, end: { kind: 'cut', role: 'right' }, elements: { kind: 'set' } })
    expect(v1.video?.elements).toBe(true)
    expect(v1.input.__shot).toEqual({ index: 0, role: 'front', endRole: 'right', duration: 3 })
    expect(v2.input.prompt).toBe(`${ELEMENT_TAG} 振り向く`)
    expect('cfg_scale' in v2.input).toBe(false)
    expect(v2.input.__shot).toEqual({ index: 1, role: 'back', endRole: null, duration: 3 })
    expect(m.dependsOn).toEqual(['v1', 'v2'])
    expect(inputNodesOf(snap).cutSetInputId).toBe('cs')
  })
  it('App の構成（shotsFromCanvas）と、SKU ごとの充足（役割のカットが無いショットは飛ばし、結合は作れる分だけ待つ）', () => {
    expect(shotsFromCanvas(snap)).toEqual([{ role: 'front', endRole: 'right', duration: 3, motion: 'Feet stay planted.' }, { role: 'back', duration: 3, motion: '振り向く' }])
    const { tasks } = planTasks(snap)
    const byNode = taskMapOf(tasks)
    const [v1, v2, m] = tasks
    const frontRight = { cuts: [{ role: 'front', path: 'f' }, { role: 'right', path: 'r' }] }
    expect(taskSatisfied(v1, frontRight, byNode)).toBe(true)
    expect(taskSatisfied(v2, frontRight, byNode)).toBe(false)
    expect(availableVideos(m, frontRight, byNode)).toEqual(['v1'])
    expect(taskSatisfied(m, frontRight, byNode)).toBe(true)
    const backOnly = { cuts: [{ role: 'back', path: 'b' }] }
    expect(taskSatisfied(v1, backOnly, byNode)).toBe(false)
    expect(taskSatisfied(v2, backOnly, byNode)).toBe(false)   // elements には正面が要る
    expect(taskSatisfied(m, backOnly, byNode)).toBe(false)
  })
  it('翻訳が要るのは利用者の日本語だけ（英語・対訳のある組み込み文は除く）。翻訳表があればプロンプトに反映', () => {
    expect(promptTextsToTranslateForPlan(snap)).toEqual(['振り向く'])
    const { tasks } = planTasks({ ...snap, promptTranslations: { '振り向く': 'turns around' } })
    expect(tasks[1].input.prompt).toBe(`${ELEMENT_TAG} turns around`)
  })
  it('開始フレーム未接続でもカット一式があれば正面を開始にする。elements に対応しないモデルでは一式を無視', () => {
    const only = planTasks({ nodes: [cs, tp('tp', 'p'), vg('v1')], edges: [e('cs', 'out-cuts-set', 'v1', 'in-cuts-set'), e('tp', 'out-text-text-out', 'v1', 'in-text')] })
    expect(only.tasks[0].inputs).toEqual({ elements: { kind: 'set' }, start: { kind: 'cut', role: 'front' } })
    const ltx = planTasks({ nodes: [cs, tp('tp', 'p'), vg('v1', { model: 'ltx-2.3-fast' })], edges: [e('cs', 'out-cuts-set', 'v1', 'in-cuts-set'), e('tp', 'out-text-text-out', 'v1', 'in-text')] })
    expect(ltx.tasks[0].inputs).toEqual({ start: { kind: 'cut', role: 'front' } })
    expect(ltx.warnings.some((w) => w.includes('elements'))).toBe(true)
  })
})

describe('planTasks: 動画があるジョブは動画だけ（2026-10-31 決定）と段の数え方', () => {
  const pl = { id: 'pl', data: { type: 'productLayout', params: {} } }
  it('動画につながらない切り抜き（Product Layout 向け）は対象外にして注意を出す', () => {
    const { tasks, warnings } = planTasks({
      nodes: [bi, rb('rb'), pl, tp('tp', 'p'), vg('v1')],
      edges: [e('bi', 'out-image-image', 'rb', 'in-image-image'), e('rb', 'out-cutout-cutout', 'pl', 'in-cutout-cutout'), e('bi', 'out-image-image', 'v1', 'in-image'), e('tp', 'out-text-text-out', 'v1', 'in-text')],
    })
    expect(tasks.map((t) => t.nodeId)).toEqual(['v1'])
    expect(warnings).toContain('この構成では動画だけを処理します（Remove Background の画像は作りません）')
    expect(warnings).toContain('この構成では Product Layout の画像は作りません（動画だけを処理します）')
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

describe('旧 Product Video ノードの展開（決定的な id・既存ジョブのタスク id と一致）', () => {
  const pv = { id: 'pv', position: { x: 10, y: 20 }, data: { type: 'productVideo', label: '商品動画', params: { templateId: 'turntable12' } } }
  it('Cut Set Input / 共通の説明 / ショット ×N / 結合 に展開し、辺は役割ポート・カット一式・共通の説明・結合スロット', () => {
    const legacy: WorkflowSnapshot = { nodes: [pv], edges: [] }
    const ex = expandProductVideo(legacy)!
    expect(ex.nodes!.map((n) => n.id)).toEqual(['pv:cuts', 'pv:base', 'pv:shot:0', 'pv:shot:1', 'pv:shot:2', 'pv:shot:3', 'pv'])
    expect(ex.nodes!.map((n) => n.data.type)).toEqual(['cutSetInput', 'textPrompt', 'videoGen', 'videoGen', 'videoGen', 'videoGen', 'videoMerge'])
    expect(ex.edges!.filter((x) => x.target === 'pv:shot:0').map((x) => `${x.source}:${x.sourceHandle}→${x.targetHandle}`)).toEqual(['pv:cuts:out-image-front→in-image', 'pv:cuts:out-image-right→in-image-end', 'pv:cuts:out-cuts-set→in-cuts-set', 'pv:base:out-text-text-out→in-text'])
    expect(ex.edges!.filter((x) => x.target === 'pv').map((x) => `${x.source}→${x.targetHandle}`)).toEqual(['pv:shot:0→in-video-1', 'pv:shot:1→in-video-2', 'pv:shot:2→in-video-3', 'pv:shot:3→in-video-4'])
    expect(ex.nodes![2].data).toMatchObject({ label: '商品動画 1: 正面 → 右側面', model: 'kling-v3-pro', duration: '3', audioEnabled: false, params: { autoTurn: true, prompt: '足は動かさず、腕はリラックス。' } })   // ターンテーブルの補足文はそのまま（静止用の定型文だけ空にする）
    expect(JSON.stringify(expandProductVideo(legacy))).toBe(JSON.stringify(ex))   // 決定的
    expect(expandProductVideo(ex)).toBe(ex)   // 旧ノードが無ければそのまま
  })
  it('展開後の計画は旧ジョブと同じタスク id・結合の待ち先になる', () => {
    const { tasks } = planTasks({ nodes: [pv], edges: [] })
    expect(tasks.map((t) => t.nodeId)).toEqual(['pv:shot:0', 'pv:shot:1', 'pv:shot:2', 'pv:shot:3', 'pv'])
    expect(tasks[4].dependsOn).toEqual(['pv:shot:0', 'pv:shot:1', 'pv:shot:2', 'pv:shot:3'])
    expect(tasks[4].terminal).toBe(true)
    expect(shotsFromCanvas({ nodes: [pv], edges: [] }).map((s) => `${s.role}>${s.endRole}`)).toEqual(['front>right', 'right>back', 'back>left', 'left>front'])
  })
})
