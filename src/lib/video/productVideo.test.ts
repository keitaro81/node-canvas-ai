import { describe, expect, it } from 'vitest'
import { BUILTIN_EN, DEFAULT_BASE_PROMPT, END_CUT_CFG_SCALE, VIDEO_TEMPLATES, applyPromptTranslations, builtinEnglish, cutOf, elementCutsOf, hasJapanese, isStaticPresetMotion, normalizeProductVideoParams, parseShotTaskNodeId, promptTextsToTranslate, shotAvailable, shotNegativePrompt, shotPrompt, shotRoleLabel, shotTaskNodeId, shotsAvailableFor, totalSeconds, turnInstruction, videoNodeOf } from './productVideo'

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
    const en = applyPromptTranslations(v.params, {})
    expect(shotPrompt(en, en.shots[0])).toBe('Studio.\n@Element1 wearing the garment. The model stands in profile, then slowly turns to face the camera with a relaxed stance, arms hanging naturally.')
    expect(shotTaskNodeId('pv', 2)).toBe('pv:shot:2'); expect(parseShotTaskNodeId('pv:shot:2')).toEqual({ videoNodeId: 'pv', index: 2 }); expect(parseShotTaskNodeId('pv')).toBeNull()
    expect(videoNodeOf({ nodes: [{ id: 'bi', data: { type: 'batchInput' } }] })).toBeNull()
  })
})

describe('終了カットありのプロンプト', () => {
  it('(始点, 終点) の回転指示が先頭に付き、静止ショット用の定型文は無視され、自分の補足は残る', () => {
    const preset = BUILTIN_EN[VIDEO_TEMPLATES[0].shots[1].motion]   // ec15 の正面「stands facing the camera…」（既存 WF に保存されている英語）
    expect(isStaticPresetMotion(preset)).toBe(true); expect(isStaticPresetMotion(VIDEO_TEMPLATES[0].shots[1].motion)).toBe(true)
    const params = normalizeProductVideoParams({ templateId: 'custom', basePrompt: 'Studio.', shots: [
      { role: 'right', endRole: 'back', duration: 3, motion: preset },
      { role: 'back', endRole: 'left', duration: 3, motion: 'Feet stay planted.' },
      { role: 'detail', duration: 3, motion: 'breathes.' },
    ] })
    const p0 = shotPrompt(params, params.shots[0])
    expect(p0.startsWith('Studio.\n@Element1 wearing the garment. Seen in profile, the model keeps turning away from the camera')).toBe(true)
    expect(p0).not.toContain('stands facing the camera')
    expect(p0.endsWith('by the shortest movement.')).toBe(true)
    const p1 = shotPrompt(params, params.shots[1])
    expect(p1).toContain('Seen from behind, the model pivots a short quarter turn')
    expect(p1).toContain(' Feet stay planted. One continuous take')
    expect(shotPrompt(params, params.shots[2])).toBe('Studio.\n@Element1 wearing the garment. breathes.')
    // negative: 終了カットありは見せてはいけない向きを足す
    expect(shotNegativePrompt(params, params.shots[0])).toContain('facing the camera, front view')
    expect(shotNegativePrompt(params, params.shots[2])).toBe(params.negativePrompt)
    expect(turnInstruction('front', 'right').negative).toContain('back view')
    expect(turnInstruction('detail', 'front').negative).toBeNull()
    expect(END_CUT_CFG_SCALE).toBe(0.7)
  })
  it('名前付きテンプレートは保存された shots より現在の定義を優先する（custom は保存値）', () => {
    const t = normalizeProductVideoParams({ templateId: 'turntable12', shots: [{ role: 'front', duration: 5, motion: 'old' }] })
    expect(t.shots.map((s) => `${s.role}>${s.endRole}`)).toEqual(['front>right', 'right>back', 'back>left', 'left>front'])
    const c = normalizeProductVideoParams({ templateId: 'custom', shots: [{ role: 'front', duration: 5, motion: 'mine' }] })
    expect(c.shots).toEqual([{ role: 'front', duration: 5, motion: 'mine' }])
  })
})

describe('日本語で編集 → 生成時に英語', () => {
  it('組み込み文は対訳、利用者の日本語だけ翻訳対象、英語はそのまま', () => {
    expect(hasJapanese('ゆっくり回る')).toBe(true); expect(hasJapanese('slowly turns')).toBe(false)
    expect(builtinEnglish(DEFAULT_BASE_PROMPT)).toContain('Plain seamless studio background')
    expect(builtinEnglish('自作の文')).toBeNull()
    const params = normalizeProductVideoParams({ templateId: 'custom', shots: [
      { role: 'front', duration: 3, motion: VIDEO_TEMPLATES[0].shots[1].motion },        // 組み込み（対訳あり）
      { role: 'right', endRole: 'back', duration: 3, motion: VIDEO_TEMPLATES[0].shots[1].motion },   // 終了カットあり + 静止用定型文 → 無視される
      { role: 'detail', duration: 3, motion: '襟元に寄って、ゆっくり呼吸する' },             // 利用者の日本語
      { role: 'back', duration: 3, motion: 'glances over the shoulder' },                     // 英語
    ] })
    expect(promptTextsToTranslate(params)).toEqual(['襟元に寄って、ゆっくり呼吸する'])
    const en = applyPromptTranslations(params, { '襟元に寄って、ゆっくり呼吸する': 'Close on the collar, breathing slowly' })
    expect(en.basePrompt.startsWith('Plain seamless')).toBe(true)
    expect(en.negativePrompt.startsWith('fast motion')).toBe(true)
    expect(en.shots.map((s) => s.motion)).toEqual([
      BUILTIN_EN[VIDEO_TEMPLATES[0].shots[1].motion], BUILTIN_EN[VIDEO_TEMPLATES[0].shots[1].motion], 'Close on the collar, breathing slowly', 'glances over the shoulder',
    ])
    expect(shotPrompt(en, en.shots[2])).toBe(`${en.basePrompt}\n@Element1 wearing the garment. Close on the collar, breathing slowly`)
    // 翻訳表に無い日本語はそのまま（保険）
    expect(applyPromptTranslations(params, {}).shots[2].motion).toBe('襟元に寄って、ゆっくり呼吸する')
  })
})
