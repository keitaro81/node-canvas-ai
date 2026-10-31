import { describe, it, expect } from 'vitest'
import { WORKFLOW_TEMPLATES, buildProductVideoTemplate } from './index'
import { planTasks, shotsFromCanvas } from '../batch/plan'
import { appKindOf } from '../apps/appKind'

describe('テンプレートから作成（商品動画）', () => {
  it('ターンテーブル: Cut Set Input / 共通の説明 / ショット ×4 / Video Merge / Export を読みやすい id で組む', () => {
    const c = buildProductVideoTemplate('turntable12')
    expect(c.nodes.map((n) => n.id)).toEqual(['cut-set', 'base-prompt', 'shot-1', 'shot-2', 'shot-3', 'shot-4', 'merge', 'export'])
    expect(c.nodes.map((n) => n.type)).toEqual(['cutSetInputNode', 'textPromptNode', 'videoGenerationNode', 'videoGenerationNode', 'videoGenerationNode', 'videoGenerationNode', 'videoMergeNode', 'exportNode'])
    expect(c.nodes[2].data.label).toBe('ショット 1: 正面 → 右側面')
    expect(c.nodes[6].data.label).toBe('Video Merge')
    expect(c.edges.filter((e) => e.target === 'shot-1').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['cut-set:out-image-front→in-image', 'cut-set:out-image-right→in-image-end', 'cut-set:out-cuts-set→in-cuts-set', 'base-prompt:out-text-text-out→in-text'])
    expect(c.edges.filter((e) => e.target === 'export').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['merge:out-video→in-video-v0', 'cut-set:out-item-item→in-item-item'])
    expect(new Set(c.edges.map((e) => e.id)).size).toBe(c.edges.length)
    // 組んだまま一括実行の計画になり、App は商品動画
    const { tasks, warnings } = planTasks(c)
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}`)).toEqual(['shot-1:videoShot', 'shot-2:videoShot', 'shot-3:videoShot', 'shot-4:videoShot', 'merge:videoMerge'])
    expect(shotsFromCanvas(c).map((s) => `${s.role}>${s.endRole}`)).toEqual(['front>right', 'right>back', 'back>left', 'left>front'])
    expect(appKindOf(c)).toBe('video')
  })
  it('一覧は 3 構成で、ショット数と秒数を持つ', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => `${t.id}:${t.shots}:${t.seconds}`)).toEqual(['video-ec15:5:15', 'video-turntable12:4:12', 'video-short9:3:9'])
    expect(WORKFLOW_TEMPLATES[0].build().nodes.length).toBe(5 + 4)
  })
})
