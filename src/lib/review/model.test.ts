import { describe, it, expect } from 'vitest'
import {
  CUTOUT_VARIANT_KEY, cutoutNodesFromSnapshot, cutoutParamsOf, estimateZipBytes, exportParamsFromSnapshot, filterItems, identityFor,
  itemInfoOfRow, jobZipName, maskVersionOf, moveSelection, planJobExport, resultKindOf, thumbFileName, variantsFromSnapshot,
} from './model'
import { layoutIdentityString } from '../layout/identity'
import type { BatchItemRow, BatchTaskRow } from '../../types/batch'

const snapshot = {
  nodes: [
    { id: 'bi', data: { type: 'batchInput', params: {} } },
    { id: 'rb', data: { type: 'removeBackground', params: { engine: 'birefnet', alphaThreshold: 12, featherPx: 1 } } },
    { id: 'pl1', data: { type: 'productLayout', params: { variantName: 'ec_white', width: 1200, height: 1200 } } },
    { id: 'pl2', data: { type: 'productLayout', params: { variantName: 'sns', width: 1080, height: 1350, backgroundKind: 'transparent' } } },
    { id: 'ex', data: { type: 'export', params: { format: 'png', namePattern: '{sku}_{variant}' } } },
  ],
  edges: [
    { source: 'bi', sourceHandle: 'out-image-image', target: 'rb', targetHandle: 'in-image-image' },
    { source: 'ig', sourceHandle: 'out-image-image', target: 'pl2', targetHandle: 'in-image-background' },
  ],
}
const item = (over: Partial<BatchItemRow> = {}): BatchItemRow => ({
  id: 'i1', job_id: 'j', team_id: 't', sort_order: 3, original_filename: 'ABC-1_front.jpg', sku: 'ABC-1', source_path: 't/j/i1/original.jpg', interactive_path: null,
  width: 100, height: 100, status: 'ready', review: 'unreviewed', reviewed_by: null, warnings: [], created_at: '', updated_at: '', ...over,
})
const task = (over: Partial<BatchTaskRow> = {}): BatchTaskRow => ({
  id: 'task1', job_id: 'j', item_id: 'i1', team_id: 't', node_id: 'rb', endpoint: 'fal-ai/birefnet/v2', input: {}, status: 'completed', attempts: 1, error: null,
  result_path: 't/j/i1/rb-result.png', result_meta: { kind: 'mask' }, submitted_at: null, completed_at: '2026-09-23T00:00:00Z', ...over,
})

describe('review model', () => {
  it('写しからバリアントを取り出し、上書きを適用する', () => {
    const v = variantsFromSnapshot(snapshot, { pl1: { marginTop: 20 } })
    expect(v.map((x) => `${x.key}:${x.name}:${x.overridden}`)).toEqual(['pl1:ec_white:true', 'pl2:sns:false'])
    expect(v[0].params.marginTop).toBe(20)
    expect(v[0].baseParams.marginTop).toBe(8)
    expect(v[1].backgroundNodeId).toBe('ig')
    expect(variantsFromSnapshot(null, null)).toEqual([])
  })
  it('切り抜きノードと書き出し設定', () => {
    expect(cutoutNodesFromSnapshot(snapshot).map((c) => `${c.nodeId}:${c.params.alphaThreshold}`)).toEqual(['rb:12'])
    expect(exportParamsFromSnapshot(snapshot)).toMatchObject({ format: 'png', namePattern: '{sku}_{variant}' })
    expect(exportParamsFromSnapshot({})).toMatchObject({ format: 'jpeg' })
  })
  it('再実行時のパラメータはタスクの __params を優先する', () => {
    const fallback = cutoutNodesFromSnapshot(snapshot)[0].params
    expect(cutoutParamsOf(task(), fallback).alphaThreshold).toBe(12)
    expect(cutoutParamsOf(task({ input: { __params: { engine: 'bria', alphaThreshold: 30 } } }), fallback)).toMatchObject({ engine: 'bria', alphaThreshold: 30 })
  })
  it('結果の種類と版', () => {
    expect(resultKindOf(task())).toBe('mask')
    expect(resultKindOf(task({ result_meta: null, endpoint: 'fal-ai/bria/background/remove' }))).toBe('rgba')
    expect(maskVersionOf(task())).toBe('2026-09-23T00:00:00Z')
    expect(maskVersionOf(task({ completed_at: null, result_meta: { falRequestId: 'r1' } }))).toBe('r1')
  })
  it('識別値は再実行（版）とレイアウト設定で変わり、同じ入力なら同じ', () => {
    const v = variantsFromSnapshot(snapshot, null)[0]
    const a = layoutIdentityString(identityFor({ item: item(), task: task(), cutout: { alphaThreshold: 12, featherPx: 1 }, params: v.params }))
    const b = layoutIdentityString(identityFor({ item: item(), task: task(), cutout: { alphaThreshold: 12, featherPx: 1 }, params: v.params }))
    const c = layoutIdentityString(identityFor({ item: item(), task: task({ completed_at: '2026-09-24T00:00:00Z' }), cutout: { alphaThreshold: 12, featherPx: 1 }, params: v.params }))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
  it('サムネイル名・アイテム情報・ZIP 名', () => {
    expect(thumbFileName(CUTOUT_VARIANT_KEY, 'abcdef0123456789', true)).toBe('thumb-cutout-abcdef012345.png')
    expect(thumbFileName('productLayoutNode-1', 'abcdef0123456789', false)).toBe('thumb-productLayoutNode-1-abcdef012345.jpg')
    expect(itemInfoOfRow(item())).toEqual({ sku: 'ABC-1', original: 'ABC-1_front', index: 3 })
    expect(jobZipName('2026-09-23 10:00 20枚', new Date('2026-09-23T01:00:00Z'))).toBe('2026-09-23 10_00 20枚_20260923.zip')
  })
  it('絞り込みとキーボード移動', () => {
    const items = [item({ id: 'a', review: 'ok' }), item({ id: 'b', review: 'ng' }), item({ id: 'c', status: 'failed' })]
    expect(filterItems(items, 'ok').map((i) => i.id)).toEqual(['a'])
    expect(filterItems(items, 'failed').map((i) => i.id)).toEqual(['c'])
    expect(filterItems(items, 'unreviewed').map((i) => i.id)).toEqual(['c'])
    expect(moveSelection(null, 'ArrowDown', 3, 2)).toEqual({ row: 1, col: 0 })
    expect(moveSelection({ row: 2, col: 1 }, 'ArrowDown', 3, 2)).toEqual({ row: 2, col: 1 })
    expect(moveSelection({ row: 0, col: 0 }, 'ArrowLeft', 3, 2)).toEqual({ row: 0, col: 0 })
    expect(moveSelection({ row: 1, col: 0 }, 'End', 3, 2)).toEqual({ row: 2, col: 0 })
    expect(moveSelection({ row: 1, col: 0 }, 'x', 3, 2)).toEqual({ row: 1, col: 0 })
    expect(moveSelection({ row: 1, col: 0 }, 'ArrowDown', 0, 2)).toBeNull()
  })
  it('書き出し計画は透過バリアントを PNG にし、連番はアイテムの並び順', () => {
    const variants = variantsFromSnapshot(snapshot, null)
    const plan = planJobExport([item({ sort_order: 7 })], variants, exportParamsFromSnapshot({}), new Date('2026-09-23T01:00:00Z'))
    expect(plan[0].entries.map((e) => `${e.folder}${e.base}.${e.ext}`)).toEqual(['ec_white/ABC-1_ec_white_07.jpg', 'sns/ABC-1_sns_07.png'])
    expect(estimateZipBytes(150, 1200, 1200, 'jpeg')).toBe(54_000_000)
  })
})
