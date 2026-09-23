import { describe, it, expect } from 'vitest'
import { checkLimits, extOf, falInputOf, jstDayRangeUtc, originalPath, pickResultFile, planRerun, planRetry, planTasks, resultPath, MAX_ITEMS_PER_JOB } from './_batchLogic'

describe('planTasks（写しから AI 処理を抽出）', () => {
  const snapshot = {
    nodes: [
      { id: 'bi', data: { type: 'batchInput', params: {} } },
      { id: 'rb', data: { type: 'removeBackground', params: { engine: 'birefnet', birefnetModel: 'General Use (Light)', birefnetResolution: '2048x2048', alphaThreshold: 8, featherPx: 0 } } },
      { id: 'rb2', data: { type: 'removeBackground', params: { engine: 'bria' } } },   // 未接続
      { id: 'pl', data: { type: 'productLayout', params: {} } },
      { id: 'ig', data: { type: 'imageGen', params: { executionScope: 'job', prompt: 'studio background', model: 'fal-ai/flux-2' } } },
      { id: 'ig2', data: { type: 'imageGen', params: { executionScope: 'job', prompt: '' } } },
      { id: 'ig3', data: { type: 'imageGen', params: { executionScope: 'item', prompt: 'x' } } },
    ],
    edges: [
      { source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
      { source: 'rb', sourceHandle: 'out-cutout-cutout', target: 'pl', targetHandle: 'in-cutout-cutout' },
    ],
  }
  it('Batch Input 直結の Remove Background はアイテムごと、ジョブスコープの Image Generation はジョブごと', () => {
    const { tasks, warnings } = planTasks(snapshot)
    expect(tasks.map((t) => `${t.nodeId}:${t.scope}:${t.endpoint}`)).toEqual(['rb:item:fal-ai/birefnet/v2', 'ig:job:fal-ai/flux-2'])
    expect(tasks[0].input).toMatchObject({ model: 'General Use (Light)', operating_resolution: '2048x2048', refine_foreground: false, mask_only: true })
    expect('image_url' in tasks[0].input).toBe(false)
    expect(warnings.length).toBe(2)   // rb2 未接続, ig2 プロンプト空
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
