import { describe, it, expect } from 'vitest'
import { NODE_CATALOG, catalogNode, multiHandle, portsCompatible } from './catalog'
import { REMOVE_BACKGROUND_INPUT, VIDEO_GEN_END_HANDLE, VIDEO_GEN_START_HANDLE, cutSetRoleHandle } from '../batch/plan'
import { TRY_ON_GARMENT_HANDLE, TRY_ON_MODEL_HANDLE, TRY_ON_OUTPUT_HANDLE } from '../tryon/prompt'
import { PRODUCT_LAYOUT_INPUT_CUTOUT, PRODUCT_LAYOUT_OUTPUT } from '../layout/nodeIo'
import { REMOVE_BACKGROUND_OUTPUT_HANDLE } from '../cutout/upstream'

describe('ノードのカタログ', () => {
  it('ハンドル id はノードの実装の定数と一致する', () => {
    const port = (type: string, dir: 'inputs' | 'outputs', name: string) => catalogNode(type)![dir].find((p) => p.port === name)!.handle
    expect(port('removeBackground', 'inputs', 'image')).toBe(REMOVE_BACKGROUND_INPUT)
    expect(port('removeBackground', 'outputs', 'cutout')).toBe(REMOVE_BACKGROUND_OUTPUT_HANDLE)
    expect(port('productLayout', 'inputs', 'cutout')).toBe(PRODUCT_LAYOUT_INPUT_CUTOUT)
    expect(port('productLayout', 'outputs', 'image')).toBe(PRODUCT_LAYOUT_OUTPUT)
    expect(port('videoGen', 'inputs', 'start')).toBe(VIDEO_GEN_START_HANDLE)
    expect(port('videoGen', 'inputs', 'end')).toBe(VIDEO_GEN_END_HANDLE)
    expect(port('libraryModel', 'outputs', 'left')).toBe(cutSetRoleHandle('left'))
    expect(catalogNode('cutSetInput')).toBeUndefined()   // 2026-11-01 廃止
    expect(catalogNode('referenceImage')!.build('x', { role: 'right' }).role).toBe('right')
    expect(catalogNode('referenceImage')!.build('x', { role: 'none' }).role).toBeNull()
    expect(port('tryOn', 'inputs', 'model')).toBe(TRY_ON_MODEL_HANDLE)
    expect(port('tryOn', 'inputs', 'garment')).toBe(TRY_ON_GARMENT_HANDLE)
    expect(port('tryOn', 'outputs', 'image')).toBe(TRY_ON_OUTPUT_HANDLE)
    expect(port('libraryModel', 'outputs', 'right')).toBe(cutSetRoleHandle('right'))
    expect(catalogNode('videoGen')!.params.some((p) => p.key === 'autoTurn')).toBe(false)
    expect(port('export', 'inputs', 'item')).toBe('in-item-item')
  })
  it('種別は重複せず、build は data.type を返す', () => {
    expect(new Set(NODE_CATALOG.map((n) => n.type)).size).toBe(NODE_CATALOG.length)
    for (const n of NODE_CATALOG) expect(n.build(n.label, {}).type).toBe(n.type)
    expect(catalogNode('tryOn')!.build('x', { role: 'right', resolution: '4K' }).params).toEqual({ resolution: '2K', note: '', role: 'right' })
  })
  it('相性: 同じ種類どうし、cutout → image は受け入れる入力だけ', () => {
    const garment = catalogNode('tryOn')!.inputs.find((p) => p.port === 'garment')!
    const start = catalogNode('videoGen')!.inputs.find((p) => p.port === 'start')!
    expect(portsCompatible('cutout', garment)).toBe(true)
    expect(portsCompatible('cutout', start)).toBe(false)
    expect(portsCompatible('image', start)).toBe(true)
    expect(portsCompatible('text', start)).toBe(false)
  })
  it('複数つなげる入力のハンドル', () => {
    const exp = catalogNode('export')!
    expect(multiHandle(exp.inputs.find((p) => p.port === 'image')!, 0)).toBe('in-image-0')
    expect(multiHandle(exp.inputs.find((p) => p.port === 'video')!, 1)).toBe('in-video-v1')
    expect(multiHandle(catalogNode('videoMerge')!.inputs[0], 0)).toBe('in-video-1')
    const ref = catalogNode('imageGen')!.inputs.find((p) => p.port === 'image')!
    expect([0, 1, 2].map((i) => multiHandle(ref, i))).toEqual(['in-image', 'in-image-2', 'in-image-3'])
  })
})
