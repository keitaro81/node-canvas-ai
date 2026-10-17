import { describe, expect, it } from 'vitest'
import { VIDEO_TEMPLATES, cutOf, elementCutsOf, normalizeProductVideoParams, parseShotTaskNodeId, shotAvailable, shotPrompt, shotRoleLabel, shotTaskNodeId, shotsAvailableFor, totalSeconds, videoNodeOf } from './productVideo'

const cuts = [
  { role: 'front' as const, path: 'f.jpg' }, { role: 'right' as const, path: 'r.jpg' }, { role: 'back' as const, path: 'b.jpg' },
  { role: 'detail' as const, path: 'd.jpg' }, { role: 'left' as const, path: 'l.jpg' }, { role: 'full' as const, path: 'x.jpg' },
]

describe('productVideo', () => {
  it('テンプレートは 2 種（15 秒 / 9 秒）で、既定の設定はテンプレートのショットを展開する', () => {
    expect(VIDEO_TEMPLATES.map((t) => [t.id, totalSeconds(t.shots)])).toEqual([['ec15', 15], ['turntable12', 12], ['short9', 9]])
    const p = normalizeProductVideoParams(undefined)
    expect(p.templateId).toBe('ec15'); expect(p.shots).toHaveLength(5); expect(p.basePrompt.length).toBeGreaterThan(10)
    const c = normalizeProductVideoParams({ templateId: 'custom', shots: [{ role: 'back', duration: 99, motion: 'x' }, { role: 'nope', duration: 1 }] })
    expect(c.templateId).toBe('custom'); expect(c.shots).toEqual([{ role: 'back', duration: 15, motion: 'x' }, { role: 'front', duration: 3, motion: '' }])
    // 終了カット: 正しい役割だけ受け付け、開始と同じなら外す
    const e = normalizeProductVideoParams({ templateId: 'custom', shots: [{ role: 'front', endRole: 'right', duration: 3, motion: 't' }, { role: 'back', endRole: 'back', duration: 3, motion: 'u' }, { role: 'left', endRole: 'zzz', duration: 3, motion: 'v' }] })
    expect(e.shots.map((s) => s.endRole ?? null)).toEqual(['right', null, null])
    expect(shotRoleLabel(e.shots[0])).toBe('正面 → 右側面'); expect(shotRoleLabel(e.shots[1])).toBe('背面')
  })
  it('エレメントは正面 + 優先順の別角度 3 枚、役割の無いショットは飛ばす', () => {
    expect(elementCutsOf(cuts)).toEqual({ frontal: cuts[0], references: [cuts[1], cuts[4], cuts[2]] })
    expect(elementCutsOf([cuts[0]])).toEqual({ frontal: cuts[0], references: [] })
    expect(cutOf(cuts, 'detail')?.path).toBe('d.jpg')
    const shots = VIDEO_TEMPLATES[0].shots
    expect(shotsAvailableFor(shots, [cuts[0], cuts[3]])).toEqual([1, 3, 4])   // right / back が無い
    expect(totalSeconds(shots, [1, 3, 4])).toBe(9)
    // ターンテーブル: 終了カットの役割も揃っている区間だけ作る（left が無ければ back→left と left→front を飛ばす）
    const tt = VIDEO_TEMPLATES.find((t) => t.id === 'turntable12')!.shots
    expect(shotsAvailableFor(tt, [cuts[0], cuts[1], cuts[2]])).toEqual([0, 1])
    expect(shotAvailable(tt[3], cuts)).toBe(true)
  })
  it('写しから Product Video ノードを取り出し、ショットのプロンプトとタスク id を組む', () => {
    const snap = { nodes: [{ id: 'bi', data: { type: 'batchInput' } }, { id: 'pv', data: { type: 'productVideo', label: '  ', params: { templateId: 'short9', basePrompt: 'Studio.' } } }] }
    const v = videoNodeOf(snap)!
    expect(v.id).toBe('pv'); expect(v.label).toBe('Product Video'); expect(v.params.shots).toHaveLength(3)
    expect(shotPrompt(v.params, v.params.shots[0])).toBe('Studio.\n@Element1 wearing the garment. The model stands in profile, then slowly turns to face the camera with a relaxed stance, arms hanging naturally.')
    expect(shotTaskNodeId('pv', 2)).toBe('pv:shot:2'); expect(parseShotTaskNodeId('pv:shot:2')).toEqual({ videoNodeId: 'pv', index: 2 }); expect(parseShotTaskNodeId('pv')).toBeNull()
    expect(videoNodeOf({ nodes: [{ id: 'bi', data: { type: 'batchInput' } }] })).toBeNull()
  })
})
