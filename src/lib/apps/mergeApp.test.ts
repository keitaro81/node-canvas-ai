import { describe, it, expect } from 'vitest'
import { LOST_ERROR, autoMergeDecision, mergeAppInputsOf, mergeAppRunOf, mergeAppShapeOf, missingImageInputs, shotStateOf, shotTurnLabel } from './mergeApp'
import { latestVideoOf, mergeInputsOf } from '../video/latestVideo'

const inG = (id: string, type: string, data: Record<string, unknown> = {}, y = 0) => ({ id, type, parentId: 'g', position: { x: 0, y }, data })
const e = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })

// テンプレート「ターンテーブル」の形: 参照画像 → Kling Element / ショット × 2 → Video Merge → Export
const base = () => ({
  nodes: [
    { id: 'g', type: 'groupNode', data: {} },
    inG('rf', 'referenceImageNode', { type: 'referenceImage', label: 'Reference Image', photoHint: '正面', imageUrl: 'https://x/f.jpg' }, 0),
    inG('rr', 'referenceImageNode', { type: 'referenceImage', label: 'Reference Image', photoHint: '右側面', imageUrl: null }, 400),
    inG('tp', 'textPromptNode', { type: 'textPrompt', label: 'Text Prompt', params: { prompt: '白背景' } }, 100),
    inG('ke', 'klingElementNode', { type: 'klingElement' }),
    inG('v1', 'videoGenerationNode', { type: 'videoGen', status: 'idle' }),
    inG('v2', 'videoGenerationNode', { type: 'videoGen', status: 'idle' }),
    inG('m', 'videoMergeNode', { type: 'videoMerge' }),
    inG('ex', 'exportNode', { type: 'export' }),
  ] as Array<{ id: string; type: string; parentId?: string; position?: { x: number; y: number }; data: Record<string, unknown> }>,
  edges: [
    e('rf', 'out-image', 'v1', 'in-image'), e('rr', 'out-image', 'v1', 'in-image-end'),
    e('rr', 'out-image', 'v2', 'in-image'), e('rf', 'out-image', 'v2', 'in-image-end'),
    e('rf', 'out-image', 'ke', 'in-image-frontal'), e('rr', 'out-image', 'ke', 'in-image-ref1'),
    e('ke', 'out-element-element', 'v1', 'in-element-1'),
    e('tp', 'out-text-text-out', 'v1', 'in-text'), e('tp', 'out-text-text-out', 'v2', 'in-text'),
    e('v2', 'out-video', 'm', 'in-video-2'), e('v1', 'out-video', 'm', 'in-video-1'),
    e('m', 'out-video', 'ex', 'in-video-v0'),
  ],
})

describe('生成 App の「ショット → 結合」（2026-11-02 メモ 54）', () => {
  it('Video Generation を並べて Video Merge でまとめる形なら、結合の順にショットを返す', () => {
    const { nodes, edges } = base()
    expect(mergeAppShapeOf('g', nodes, edges)).toEqual({ mergeId: 'm', shotIds: ['v1', 'v2'], exportId: 'ex' })
  })
  it('結合しない並列・画像の生成が混ざる・ショットどうしがつながる・Batch Input がある形は対象外', () => {
    const { nodes, edges } = base()
    expect(mergeAppShapeOf('g', nodes, edges.filter((x) => !(x.source === 'v2' && x.target === 'm')))).toBeNull()   // v2 が結合に入らない
    expect(mergeAppShapeOf('g', [...nodes, inG('ig', 'imageGenerationNode', { type: 'imageGen' })], edges)).toBeNull()
    expect(mergeAppShapeOf('g', nodes, [...edges, e('v1', 'out-video', 'v2', 'in-video')])).toBeNull()
    expect(mergeAppShapeOf('g', [...nodes, inG('bi', 'batchInputNode', { type: 'batchInput' })], edges)).toBeNull()
    expect(mergeAppShapeOf('g', nodes.filter((n) => n.id !== 'v2'), edges)).toBeNull()   // ショットが 1 つなら今までの App
    expect(mergeAppShapeOf(null, nodes, edges)).toBeNull()
  })
  it('結合の入力に Reference Video（決まった動画）や Video Result を挟んでもよい', () => {
    const { nodes, edges } = base()
    const withClip = [...nodes, inG('rv', 'referenceVideoNode', { type: 'referenceVideo', videoUrl: 'https://x/intro.mp4' }), inG('d2', 'videoDisplayNode', {})]
    const viaResult = edges.filter((x) => !(x.source === 'v2' && x.target === 'm')).concat([e('v2', 'out-video', 'd2', 'in-video'), e('d2', 'out-video', 'm', 'in-video-3'), e('rv', 'out-video', 'm', 'in-video-4')])
    expect(mergeAppShapeOf('g', withClip, viaResult)?.shotIds).toEqual(['v1', 'v2'])
  })
  it('App の入力欄: ショットか Kling Element につながる参照画像と文（「表示」を外したものは出さない）。空の写真を数える', () => {
    const { nodes, edges } = base()
    const shape = mergeAppShapeOf('g', nodes, edges)!
    const inputs = mergeAppInputsOf('g', nodes, edges, shape)
    expect(inputs.map((i) => `${i.kind}:${i.nodeId}:${i.hint}`)).toEqual(['image:rf:正面', 'image:rr:右側面', 'text:tp:null'])
    expect(missingImageInputs(inputs, nodes).map((i) => i.nodeId)).toEqual(['rr'])
    const hidden = nodes.map((n) => (n.id === 'tp' ? { ...n, data: { ...n.data, capsuleFields: { prompt: { id: 'prompt', capsuleVisibility: 'hidden' } } } } : n))
    expect(mergeAppInputsOf('g', hidden, edges, shape).map((i) => i.nodeId)).toEqual(['rf', 'rr'])
    expect(shotTurnLabel('v1', nodes, edges)).toBe('正面 → 右側面')
  })
  it('Video Generation の今の動画は最後にできた Video Result（キャンバスの結合も拾える）', () => {
    const { nodes, edges } = base()
    const ns = [...nodes, inG('d1', 'videoDisplayNode', { videoUrl: 'https://x/old.mp4', status: 'completed' }), inG('d1b', 'videoDisplayNode', { videoUrl: 'https://x/new.mp4', status: 'completed' }), inG('d1c', 'videoDisplayNode', { videoUrl: null, status: 'failed' })]
    const es = [...edges, e('v1', 'out-video', 'd1', 'in-video'), e('v1', 'out-video', 'd1b', 'in-video'), e('v1', 'out-video', 'd1c', 'in-video')]
    expect(latestVideoOf('v1', ns, es)).toBe('https://x/new.mp4')
    expect(latestVideoOf('v2', ns, es)).toBeNull()
    expect(mergeInputsOf('m', ns, es).map((i) => `${i.slot}:${i.sourceId}:${i.url}`)).toEqual(['1:v1:https://x/new.mp4', '2:v2:null'])
  })
  it('ショットの状態: 実行前の結果を除いて今回の進みを見る', () => {
    const { nodes, edges } = base()
    const before = new Set(['d1'])
    const ns = [...nodes, inG('d1', 'videoDisplayNode', { videoUrl: 'https://x/old.mp4', status: 'completed' })]
    const es = [...edges, e('v1', 'out-video', 'd1', 'in-video')]
    expect(shotStateOf('v1', ns, es)).toEqual({ status: 'done', videoUrl: 'https://x/old.mp4', error: null })
    expect(shotStateOf('v1', ns, es, before).status).toBe('running')   // 新しい結果がまだ無い
    const running = [...ns, inG('d2', 'videoDisplayNode', { videoUrl: null, status: 'processing' })]
    const es2 = [...es, e('v1', 'out-video', 'd2', 'in-video')]
    expect(shotStateOf('v1', running, es2, before).status).toBe('running')
    const done = running.map((n) => (n.id === 'd2' ? { ...n, data: { videoUrl: 'https://x/new.mp4', status: 'completed' } } : n))
    expect(shotStateOf('v1', done, es2, before)).toEqual({ status: 'done', videoUrl: 'https://x/new.mp4', error: null })
    const failed = running.map((n) => (n.id === 'd2' ? { ...n, data: { videoUrl: null, status: 'failed', error: 'timeout' } } : n))
    expect(shotStateOf('v1', failed, es2, before)).toEqual({ status: 'failed', videoUrl: null, error: 'timeout' })
    const early = ns.map((n) => (n.id === 'v1' ? { ...n, data: { ...n.data, status: 'failed', error: '参照画像をアップロードしてください' } } : n))
    expect(shotStateOf('v1', early, es, before)).toEqual({ status: 'failed', videoUrl: null, error: '参照画像をアップロードしてください' })
  })
  it('今回の実行は Video Merge の data.appRun から読む（壊れた値は無視・2026-11-08 メモ 71）', () => {
    expect(mergeAppRunOf({ appRun: { id: 1, startedAt: '2026-11-08T00:00:00Z', since: { v1: ['d1'], v2: [] } } })).toEqual({ id: 1, startedAt: '2026-11-08T00:00:00Z', since: { v1: ['d1'], v2: [] } })
    expect(mergeAppRunOf({ appRun: null })).toBeNull()
    expect(mergeAppRunOf({})).toBeNull()
    expect(mergeAppRunOf({ appRun: { id: 'x', startedAt: 1, since: {} } })).toBeNull()
  })
  it('結合に進む判断: 作っている間は wait、全ショットの動画がそろえば merge、失敗や「結果が見つからない」ショットがあれば stop', () => {
    const { nodes, edges } = base()
    const t0 = Date.parse('2026-11-08T00:00:00Z')
    const run = { id: 1, startedAt: '2026-11-08T00:00:00Z', since: { v1: [], v2: [] } }
    expect(autoMergeDecision(run, ['v1', 'v2'], nodes, edges, t0 + 1000).decision).toBe('wait')   // 作り始めた直後・結果はまだ無い
    const lost = autoMergeDecision(run, ['v1', 'v2'], nodes, edges, t0 + 120_000)                   // 90 秒経っても結果が無く、生成も動いていない
    expect(lost.decision).toBe('stop')
    expect(lost.states.v1).toEqual({ status: 'failed', videoUrl: null, error: LOST_ERROR })
    const running = nodes.map((n) => (n.id === 'v1' || n.id === 'v2' ? { ...n, data: { ...n.data, status: 'processing' } } : n))
    expect(autoMergeDecision(run, ['v1', 'v2'], running, edges, t0 + 120_000).decision).toBe('wait')   // 生成が動いていれば時間が経っても待つ
    const ns = [...nodes, inG('d1', 'videoDisplayNode', { videoUrl: 'https://x/1.mp4', status: 'completed' }), inG('d2', 'videoDisplayNode', { videoUrl: 'https://x/2.mp4', status: 'completed' })]
    const es = [...edges, e('v1', 'out-video', 'd1', 'in-video'), e('v2', 'out-video', 'd2', 'in-video')]
    expect(autoMergeDecision(run, ['v1', 'v2'], ns, es, t0 + 120_000).decision).toBe('merge')
    const one = { id: 2, startedAt: '2026-11-08T00:10:00Z', since: { v1: ['d1'] } }   // 片方だけ作り直す: since に無いショットは最後の動画を使う
    const ns2 = [...ns, inG('d1b', 'videoDisplayNode', { videoUrl: 'https://x/1b.mp4', status: 'completed' })]
    const es2 = [...es, e('v1', 'out-video', 'd1b', 'in-video')]
    expect(autoMergeDecision(one, ['v1', 'v2'], ns2, es2, Date.parse('2026-11-08T00:12:00Z')).decision).toBe('merge')
    const failed = ns.map((n) => (n.id === 'd2' ? { ...n, data: { videoUrl: null, status: 'failed', error: 'timeout' } } : n))
    expect(autoMergeDecision(run, ['v1', 'v2'], failed, es, t0 + 5000).decision).toBe('stop')
    // 結果のノードが「作成中」のまま動画が入らず、生成も動いていない（読み込み直しで途切れた）→ 90 秒を過ぎたら結果が見つからない扱い。生成が動いていれば待つ
    const stuck = ns.map((n) => (n.id === 'd2' ? { ...n, data: { videoUrl: null, status: 'processing' } } : n))
    expect(autoMergeDecision(run, ['v1', 'v2'], stuck, es, t0 + 5000).decision).toBe('wait')
    expect(autoMergeDecision(run, ['v1', 'v2'], stuck, es, t0 + 120_000).states.v2).toEqual({ status: 'failed', videoUrl: null, error: LOST_ERROR })
    const stuckButRunning = stuck.map((n) => (n.id === 'v2' ? { ...n, data: { ...n.data, status: 'processing' } } : n))
    expect(autoMergeDecision(run, ['v1', 'v2'], stuckButRunning, es, t0 + 120_000).decision).toBe('wait')
  })
})
