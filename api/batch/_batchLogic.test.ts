import { describe, it, expect } from 'vitest'
import { checkLimits, dependencyOf, dependentTaskIds, extOf, falInputOf, jstDayRangeUtc, originalPath, pickCutoutImage, pickResultFile, planRerun, planRetry, planTasks, resultPath, selectSubmittable, MAX_ITEMS_PER_JOB } from './_batchLogic'

describe('planTasks（写しから AI 処理を抽出）', () => {
  const snapshot = {
    nodes: [
      { id: 'bi', data: { type: 'batchInput', params: {} } },
      { id: 'rb', data: { type: 'removeBackground', params: { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '2048x2048', alphaThreshold: 8, featherPx: 0 } } },
      { id: 'rb2', data: { type: 'removeBackground', params: { engine: 'bria' } } },   // 未接続
      { id: 'pl', data: { type: 'productLayout', params: {} } },
      { id: 'pl-bg', data: { type: 'productLayout', params: { backgroundKind: 'image' } } },
      { id: 'tp', data: { type: 'textPrompt', params: { prompt: 'studio background' } } },
      { id: 'ig', data: { type: 'imageGen', params: { executionScope: 'job', model: 'fal-ai/nano-banana-2', aspectRatio: '9:16', resolution: '1K' } } },   // 背景につながる
      { id: 'disp', data: { type: 'imageDisplay' } },
      { id: 'ig2', data: { type: 'imageGen', params: { executionScope: 'job', prompt: 'unused' } } },   // 背景につながっていない
      { id: 'ig3', data: { type: 'imageGen', params: { executionScope: 'item', prompt: 'x' } } },
    ],
    edges: [
      { source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
      { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl', targetHandle: 'in-cutout-cutout' },
      { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl-bg', targetHandle: 'in-cutout-cutout' },
      { source: 'tp', sourceHandle: 'out-text-text-out', target: 'ig', targetHandle: 'in-text' },
      { source: 'ig', sourceHandle: 'out-image-image-out', target: 'disp', targetHandle: 'in-image-image-in' },
      { source: 'disp', sourceHandle: 'out-image-image', target: 'pl-bg', targetHandle: 'in-image-background' },
    ],
  }
  it('Batch Input 直結の Remove Background はアイテムごと、背景入力に行き着くジョブごとの Image Generation は 1 件（結果ノード経由でも）', () => {
    const { tasks, warnings } = planTasks(snapshot)
    expect(tasks.map((t) => `${t.nodeId}:${t.scope}:${t.endpoint}`)).toEqual(['rb:item:fal-ai/birefnet/v2', 'ig:job:fal-ai/nano-banana-2'])
    expect(tasks[0].input).toMatchObject({ model: 'General Use (Light)', operating_resolution: '2048x2048', refine_foreground: false, mask_only: true })
    expect('image_url' in tasks[0].input).toBe(false)
    expect(tasks[1].input).toEqual({ prompt: 'studio background', aspect_ratio: '9:16', resolution: '1K' })   // プロンプトは Text Prompt から
    expect(warnings.length).toBe(2)   // rb2 未接続, ig2 背景につながっていない
  })
  it('背景の生成器がアイテムごと・プロンプト無しなら対象外（警告）', () => {
    const s2 = { ...snapshot, nodes: snapshot.nodes.map((n) => (n.id === 'ig' ? { ...n, data: { ...n.data, params: { ...n.data.params, executionScope: 'item' } } } : n)) }
    const r = planTasks(s2)
    expect(r.tasks.map((t) => t.nodeId)).toEqual(['rb'])
    expect(r.warnings.some((w) => w.includes('ジョブごと'))).toBe(true)
    const s3 = { ...snapshot, edges: snapshot.edges.filter((e) => e.target !== 'ig') }
    expect(planTasks(s3).tasks.map((t) => t.nodeId)).toEqual(['rb'])
  })
  it('空/不正な写しは空計画', () => {
    expect(planTasks(null).tasks).toEqual([])
    expect(planTasks({}).tasks).toEqual([])
  })
})

describe('checkLimits（4-7）', () => {
  const base = { dailyLimit: 300, usedToday: 0, activeJobs: 0, newItems: 20 }
  it('正常・50 超・同時ジョブ・日次上限', () => {
    expect(checkLimits(base)).toEqual({ ok: true })
    expect(checkLimits({ ...base, newItems: MAX_ITEMS_PER_JOB + 1 })).toMatchObject({ ok: false, code: 'items_limit', status: 400 })
    expect(checkLimits({ ...base, activeJobs: 2 })).toMatchObject({ ok: false, code: 'active_jobs', status: 429 })
    expect(checkLimits({ ...base, usedToday: 290 })).toMatchObject({ ok: false, code: 'daily_limit', status: 429 })
    expect(checkLimits({ ...base, usedToday: 280 })).toEqual({ ok: true })
    expect(checkLimits({ ...base, newItems: 0 })).toMatchObject({ ok: false, code: 'no_items' })
  })
})

describe('日付・パス', () => {
  it('JST の当日範囲（UTC 15:00 境界）', () => {
    const r = jstDayRangeUtc(new Date('2026-09-23T15:30:00Z'))   // JST 9/24 00:30
    expect(r).toEqual({ start: '2026-09-23T15:00:00.000Z', end: '2026-09-24T15:00:00.000Z', day: '2026-09-24' })
    expect(jstDayRangeUtc(new Date('2026-09-23T14:59:59Z')).day).toBe('2026-09-23')
  })
  it('保存パス', () => {
    expect(extOf('t/interactive/n/items/x-AB_1.JPEG')).toBe('jpg')
    expect(originalPath('team', 'job', 'item', 'a/b/c.webp')).toBe('team/job/item/original.webp')
    expect(resultPath({ team_id: 't', job_id: 'j', item_id: 'i', node_id: 'rb' }, 'image/png')).toBe('t/j/i/rb-result.png')
    expect(resultPath({ team_id: 't', job_id: 'j', item_id: null, node_id: 'ig' }, 'image/jpeg')).toBe('t/j/job/ig-result.jpg')
  })
  it('結果ファイルの選択: 切り抜きはマスク、画像生成は 1 枚目', () => {
    expect(pickResultFile('fal-ai/birefnet/v2', { image: { url: 'i' }, mask_image: { url: 'm', width: 1, height: 2 } })).toEqual({ url: 'm', kind: 'mask', width: 1, height: 2 })
    expect(pickResultFile('fal-ai/bria/background/remove', { image: { url: 'p' } })?.kind).toBe('rgba')
    expect(pickResultFile('fal-ai/flux-2', { images: [{ url: 'g', width: 5, height: 6 }] })).toEqual({ url: 'g', kind: 'image', width: 5, height: 6 })
    expect(pickResultFile('fal-ai/flux-2', {})).toBeNull()
    expect(pickResultFile('fal-ai/birefnet/v2', {})).toBeNull()
  })
})

describe('planRetry（失敗分の再実行）', () => {
  it('失敗タスクだけを戻し、失敗アイテムは原因が失敗タスクのものだけ待機へ', () => {
    const tasks = [
      { id: 't1', item_id: 'i1', status: 'failed' },
      { id: 't2', item_id: 'i2', status: 'completed' },
      { id: 't3', item_id: 'i3', status: 'failed' },
      { id: 'tj', item_id: null, status: 'completed' },
    ]
    const items = [
      { id: 'i1', status: 'failed' }, { id: 'i2', status: 'ready' }, { id: 'i3', status: 'failed' },
      { id: 'i4', status: 'failed' },   // 元画像コピー失敗（タスク無し）→ 対象外
    ]
    const plan = planRetry(tasks, items)
    expect(plan.taskIds).toEqual(['t1', 't3'])
    expect(plan.itemIds).toEqual(['i1', 'i3'])
  })
  it('ジョブごとのタスクが失敗していれば失敗アイテム全部を待機へ', () => {
    const plan = planRetry([{ id: 'tj', item_id: null, status: 'failed' }, { id: 't1', item_id: 'i1', status: 'completed' }], [{ id: 'i1', status: 'failed' }, { id: 'i2', status: 'failed' }])
    expect(plan.taskIds).toEqual(['tj'])
    expect(plan.itemIds).toEqual(['i1', 'i2'])
  })
  it('失敗が無ければ空', () => {
    expect(planRetry([{ id: 't', item_id: 'i', status: 'completed' }], [{ id: 'i', status: 'ready' }])).toEqual({ taskIds: [], itemIds: [] })
  })
})

describe('planRerun（NG のみ再実行）と falInputOf', () => {
  const tasks = [
    { id: 't1', item_id: 'i1', node_id: 'rb', status: 'completed' },
    { id: 't2', item_id: 'i2', node_id: 'rb', status: 'failed' },
    { id: 't3', item_id: 'i3', node_id: 'rb', status: 'submitted' },
    { id: 'tx', item_id: 'i1', node_id: 'other', status: 'completed' },
  ]
  it('終了済みのタスクだけを対象にし、投入中・ジョブ外・タスク無しは理由付きで飛ばす', () => {
    const p = planRerun(tasks, ['i1', 'i2', 'i3', 'i4'], 'rb', ['i1', 'i2', 'i3', 'i4', 'i9', 'i1'])
    expect(p.taskIds).toEqual(['t1', 't2'])
    expect(p.itemIds).toEqual(['i1', 'i2'])
    expect(p.skipped).toEqual([{ itemId: 'i3', reason: 'task_submitted' }, { itemId: 'i4', reason: 'no_task' }, { itemId: 'i9', reason: 'not_in_job' }])
  })
  it('内部用キー（__ 始まり）は fal に送らない', () => {
    expect(falInputOf({ input: { model: 'x', __kind: 'cutout', __params: { engine: 'bria' } } })).toEqual({ model: 'x' })
    expect(falInputOf({ input: null })).toEqual({})
  })
})

describe('mapLimit（同時数つきの並列処理）', () => {
  it('同時に limit 件までしか走らず、全件処理する', async () => {
    const { mapLimit } = await import('./_batchLogic')
    let running = 0, peak = 0
    const seen: number[] = []
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++; peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      seen.push(n); running--
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    await mapLimit([], 3, async () => { throw new Error('never') })
  })
})

describe('planTasks（フェーズ C: AI 処理 2 段までの連鎖）', () => {
  const rbParams = { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '1024x1024', alphaThreshold: 8, featherPx: 0 }
  it('③ 写真 → レタッチ（結果ノード経由）→ 切り抜き → レイアウト: レタッチが 1 段目、切り抜きが 2 段目でレタッチ待ち', () => {
    const snap = {
      nodes: [
        { id: 'bi', data: { type: 'batchInput', params: {} } },
        { id: 'tp', data: { type: 'textPrompt', params: { prompt: 'soft retouch' } } },
        { id: 'gen', data: { type: 'imageGen', label: 'レタッチ', params: { editModel: 'fal-ai/nano-banana-2', aspectRatio: 'auto', resolution: '1K' } } },
        { id: 'disp', data: { type: 'imageDisplay' } },
        { id: 'rb', data: { type: 'removeBackground', params: rbParams } },
        { id: 'pl', data: { type: 'productLayout', params: {} } },
      ],
      edges: [
        { source: 'bi', sourceHandle: 'out-image-image', target: 'gen', targetHandle: 'in-image-1' },
        { source: 'tp', sourceHandle: 'out-text-text-out', target: 'gen', targetHandle: 'in-text' },
        { source: 'gen', sourceHandle: 'out-image-image-out', target: 'disp', targetHandle: 'in-image-image-in' },
        { source: 'disp', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
        { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl', targetHandle: 'in-cutout-cutout' },
      ],
    }
    const { tasks, warnings } = planTasks(snap)
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}:${t.dependsOn ?? '-'}:${t.endpoint}`)).toEqual(['gen:imageEdit:1:-:fal-ai/nano-banana-2/edit', 'rb:cutout:2:gen:fal-ai/birefnet/v2'])
    expect(tasks[0].input).toEqual({ prompt: 'soft retouch', aspect_ratio: 'auto', resolution: '1K' })
    expect(tasks[0].label).toBe('レタッチ')
    expect(tasks[1].dualOutput).toBe(false)
    expect(tasks[1].input.mask_only).toBe(true)
  })
  it('④ 写真 → 切り抜き → 合成: 切り抜きは両出力（mask_only=false）、合成は 2 段目で切り抜き待ち', () => {
    const snap = {
      nodes: [
        { id: 'bi', data: { type: 'batchInput', params: {} } },
        { id: 'rb', data: { type: 'removeBackground', params: rbParams } },
        { id: 'tp', data: { type: 'textPrompt', params: { prompt: 'on a model in a studio' } } },
        { id: 'comp', data: { type: 'imageGen', label: '合成', params: { model: 'openai/gpt-image-2', gptImageSize: 'auto' } } },
        { id: 'pl', data: { type: 'productLayout', params: {} } },
      ],
      edges: [
        { source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
        { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'comp', targetHandle: 'in-image-1' },
        { source: 'tp', sourceHandle: 'out-text-text-out', target: 'comp', targetHandle: 'in-text' },
        { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl', targetHandle: 'in-cutout-cutout' },
      ],
    }
    const { tasks, warnings } = planTasks(snap)
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}:${t.dependsOn ?? '-'}`)).toEqual(['rb:cutout:1:-', 'comp:imageEdit:2:rb'])
    expect(tasks[0].dualOutput).toBe(true)
    expect(tasks[0].input.mask_only).toBe(false)
    expect(tasks[1].endpoint).toBe('openai/gpt-image-2/edit')
    expect(tasks[1].input).toEqual({ prompt: 'on a model in a studio', image_size: 'auto' })
  })
  it('3 段目は対象外（警告）。プロンプト無しの編集も対象外。② 並列は 1 段目として両方入る', () => {
    const snap = {
      nodes: [
        { id: 'bi', data: { type: 'batchInput', params: {} } },
        { id: 'rb', data: { type: 'removeBackground', params: rbParams } },
        { id: 'tp', data: { type: 'textPrompt', params: { prompt: 'p' } } },
        { id: 'g1', data: { type: 'imageGen', label: '一段目', params: {} } },
        { id: 'g2', data: { type: 'imageGen', label: '二段目', params: {} } },
        { id: 'g3', data: { type: 'imageGen', label: '三段目', params: {} } },
        { id: 'g0', data: { type: 'imageGen', label: 'プロンプト無し', params: {} } },
      ],
      edges: [
        { source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
        { source: 'bi', sourceHandle: 'out-image-image', target: 'g1', targetHandle: 'in-image-1' },
        { source: 'tp', sourceHandle: 'out-text-text-out', target: 'g1', targetHandle: 'in-text' },
        { source: 'g1', sourceHandle: 'out-image-image-out', target: 'g2', targetHandle: 'in-image-1' },
        { source: 'tp', sourceHandle: 'out-text-text-out', target: 'g2', targetHandle: 'in-text' },
        { source: 'g2', sourceHandle: 'out-image-image-out', target: 'g3', targetHandle: 'in-image-1' },
        { source: 'tp', sourceHandle: 'out-text-text-out', target: 'g3', targetHandle: 'in-text' },
        { source: 'bi', sourceHandle: 'out-image-image', target: 'g0', targetHandle: 'in-image-1' },
      ],
    }
    const { tasks, warnings } = planTasks(snap)
    expect(tasks.map((t) => `${t.nodeId}:${t.stage}`)).toEqual(['rb:1', 'g1:1', 'g2:2'])
    expect(warnings.some((w) => w.includes('三段目') && w.includes('2 段まで'))).toBe(true)
    expect(warnings.some((w) => w.includes('プロンプト無し'))).toBe(true)
  })
})

describe('selectSubmittable / dependencyOf / pickCutoutImage', () => {
  const t = (id: string, item: string | null, node: string, status: string, dep: string | null = null) => ({ id, item_id: item, node_id: node, status, input: dep ? { __depends_on: dep } : {} })
  it('前段待ちは投入せず、前段が終わっていれば投入でき、前段が失敗なら失敗扱いに', () => {
    const all = [t('a1', 'i1', 'gen', 'completed'), t('a2', 'i1', 'rb', 'pending', 'gen'), t('b1', 'i2', 'gen', 'submitted'), t('b2', 'i2', 'rb', 'pending', 'gen'), t('c1', 'i3', 'gen', 'failed'), t('c2', 'i3', 'rb', 'pending', 'gen'), t('d', null, 'bg', 'pending')]
    const r = selectSubmittable(all.filter((x) => x.status === 'pending'), all)
    expect(r.ready.map((x) => x.id)).toEqual(['a2', 'd'])
    expect(r.waiting.map((x) => x.id)).toEqual(['b2'])
    expect(r.blockedByFailure.map((x) => x.id)).toEqual(['c2'])
    expect(dependencyOf(all[1])).toBe('gen')
    expect(dependencyOf(all[0])).toBeNull()
  })
  it('透過画像は切り抜きエンジンの image。他は null', () => {
    expect(pickCutoutImage('fal-ai/birefnet/v2', { image: { url: 'https://x/rgba.png' }, mask_image: { url: 'https://x/mask.png' } })).toEqual({ url: 'https://x/rgba.png', width: undefined, height: undefined })
    expect(pickCutoutImage('fal-ai/nano-banana-2/edit', { images: [{ url: 'https://x/a.png' }] })).toBeNull()
  })
})

describe('dependentTaskIds（再度切り抜く → 後段の生成も未投入へ）', () => {
  it('対象アイテムの、そのノードを前段にするタスクだけ', () => {
    const tasks = [
      { id: 'c1', item_id: 'i1', input: { __kind: 'cutout' } },
      { id: 'g1', item_id: 'i1', input: { __kind: 'imageEdit', __depends_on: 'rb' } },
      { id: 'g2', item_id: 'i2', input: { __kind: 'imageEdit', __depends_on: 'rb' } },
      { id: 'o1', item_id: 'i1', input: { __kind: 'imageEdit', __depends_on: 'other' } },
      { id: 'bg', item_id: null, input: { __kind: 'imageGen' } },
    ]
    expect(dependentTaskIds(tasks, 'rb', ['i1'])).toEqual(['g1'])
    expect(dependentTaskIds(tasks, 'rb', ['i1', 'i2'])).toEqual(['g1', 'g2'])
    expect(dependentTaskIds(tasks, 'nope', ['i1'])).toEqual([])
  })
})
