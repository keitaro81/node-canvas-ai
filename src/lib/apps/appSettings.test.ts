import { describe, it, expect } from 'vitest'
import { appSettingFieldsOf, applyAppSettings, missingModelRoles, parseAppSettings, type AppSettings } from './appSettings'

const node = (id: string, type: string, data: Record<string, unknown>, y = 0) => ({ id, type, position: { x: 0, y }, data })
const e = (source: string, sourceHandle: string, target: string) => ({ source, sourceHandle, target })

describe('一括 App の設定（2026-11-02 メモ 46・使う人ごとに選ぶ）', () => {
  const nodes = [
    node('t', 'textPromptNode', { type: 'textPrompt', label: '服の説明', params: { prompt: '白いシャツ' } }, 300),
    node('r', 'referenceImageNode', { type: 'referenceImage', label: 'Reference Image', imageUrl: 'https://x/ref.jpg' }, 200),
    node('h', 'referenceImageNode', { type: 'referenceImage', label: '隠した参照', imageUrl: 'https://x/h.jpg', capsuleFields: { imageUrl: { id: 'imageUrl', capsuleVisibility: 'hidden' } } }, 100),
    node('m', 'libraryModelNode', { type: 'libraryModel', label: 'Model', modelId: 'm1', modelName: 'A さん', cuts: { front: { itemId: 'i1', url: 'https://x/a-front.jpg' } } }, 400),
    node('u', 'referenceImageNode', { type: 'referenceImage', label: '使っていない参照', imageUrl: 'https://x/u.jpg' }, 0),
    node('tryon', 'tryOnNode', { type: 'tryOn' }),
  ]
  const edges = [e('m', 'out-image-front', 'tryon'), e('m', 'out-image-back', 'tryon'), e('r', 'out-image', 'tryon'), e('h', 'out-image', 'tryon'), e('t', 'out-text', 'tryon'), e('u', 'out-image', 'other')]

  it('処理のノードへ直接つながる入力だけ・「表示」を外した欄は出さない・モデル → 画像 → 文の順', () => {
    const fields = appSettingFieldsOf(nodes, edges, ['tryon'])
    expect(fields.map((f) => `${f.kind}:${f.nodeId}:${f.label}`)).toEqual(['model:m:Model', 'image:r:Reference Image', 'text:t:服の説明'])
    expect(fields[0].roles).toEqual(['front', 'back'])
    expect(appSettingFieldsOf(nodes, edges, [])).toEqual([])
  })

  it('Image Generation の 2 つ目以降の画像入力は一括処理で使われないので出さない', () => {
    const ns = [node('bi', 'batchInputNode', { type: 'batchInput' }), node('r2', 'referenceImageNode', { type: 'referenceImage', label: '雰囲気' }), node('ig', 'imageGenerationNode', { type: 'imageGen' })]
    const first = [{ source: 'bi', sourceHandle: 'out-image-image', target: 'ig', targetHandle: 'in-image' }, { source: 'r2', sourceHandle: 'out-image', target: 'ig', targetHandle: 'in-image-2' }]
    expect(appSettingFieldsOf(ns, first, ['ig'])).toEqual([])
  })

  it('写しに入れる: 種類が合う設定だけ重ね、空の文はキャンバスの文のまま', () => {
    const fields = appSettingFieldsOf(nodes, edges, ['tryon'])
    const settings: AppSettings = {
      m: { kind: 'model', modelId: 'm2', modelName: 'B さん', cuts: { front: { itemId: 'j1', url: 'https://x/b-front.jpg' } } },
      r: { kind: 'image', url: 'https://x/new.jpg' },
      t: { kind: 'text', prompt: '  ' },
      h: { kind: 'image', url: 'https://x/hidden-override.jpg' },   // 表示を外した欄の設定は使わない
      tryon: { kind: 'text', prompt: 'x' },                            // 種類が合わない
    }
    const out = applyAppSettings(nodes, settings, fields)
    const byId = Object.fromEntries(out.map((n) => [n.id, n.data as Record<string, unknown>]))
    expect(byId.m).toMatchObject({ modelId: 'm2', modelName: 'B さん', cuts: { front: { url: 'https://x/b-front.jpg' } } })
    expect(byId.r).toMatchObject({ imageUrl: 'https://x/new.jpg', output: 'https://x/new.jpg' })
    expect((byId.t.params as Record<string, unknown>).prompt).toBe('白いシャツ')
    expect(byId.h.imageUrl).toBe('https://x/h.jpg')
    expect(byId.tryon).toEqual({ type: 'tryOn' })
    const typed = applyAppSettings(nodes, { t: { kind: 'text', prompt: '黒いシャツ' } }, fields)
    expect(((typed.find((n) => n.id === 't')!.data as Record<string, unknown>).params as Record<string, unknown>).prompt).toBe('黒いシャツ')
    expect(missingModelRoles(fields[0], settings.m.kind === 'model' ? settings.m.cuts : null)).toEqual(['back'])
  })

  it('覚えていた値は形を確かめて読む', () => {
    expect(parseAppSettings(null)).toEqual({})
    expect(parseAppSettings({
      a: { kind: 'image', url: 'https://x/a.jpg' },
      b: { kind: 'model', modelId: 'm', modelName: 1, cuts: { front: { itemId: 'i', url: 'https://x/f.jpg' }, detail: { url: 'https://x/d.jpg' }, back: { url: '' } } },
      c: { kind: 'text', prompt: 'ok' },
      d: { kind: 'image' },
      e: 'x',
    })).toEqual({
      a: { kind: 'image', url: 'https://x/a.jpg' },
      b: { kind: 'model', modelId: 'm', modelName: null, cuts: { front: { itemId: 'i', url: 'https://x/f.jpg' } } },
      c: { kind: 'text', prompt: 'ok' },
    })
  })
})
