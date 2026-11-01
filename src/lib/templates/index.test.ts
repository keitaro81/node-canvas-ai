import { describe, it, expect } from 'vitest'
import { WORKFLOW_TEMPLATES, buildPostProductionTemplate, buildProductVideoTemplate, buildTryOnImagesTemplate, buildTryOnTurntableTemplate, type TemplateCanvas } from './index'
import { planTasks, shotsFromCanvas, type WorkflowSnapshot } from '../batch/plan'
import { appKindOf } from '../apps/appKind'

describe('テンプレートから作成（商品動画）', () => {
  it('ターンテーブル: Cut Set Input / 共通の説明 / ショット ×4 / Video Merge / Export を読みやすい id で組む', () => {
    const c = buildProductVideoTemplate('turntable12')
    expect(c.nodes.map((n) => n.id)).toEqual(['cut-set', 'base-prompt', 'shot-1', 'shot-2', 'shot-3', 'shot-4', 'merge', 'export'])
    expect(c.nodes.map((n) => n.type)).toEqual(['cutSetInputNode', 'textPromptNode', 'videoGenerationNode', 'videoGenerationNode', 'videoGenerationNode', 'videoGenerationNode', 'videoMergeNode', 'exportNode'])
    expect(c.nodes.map((n) => n.data.label)).toEqual(['Cut Set Input', 'Text Prompt', 'Video Generation', 'Video Generation', 'Video Generation', 'Video Generation', 'Video Merge', 'Export'])   // 名前は種類名のまま（2026-11-01）
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
  it('一覧は 商品写真 1 + 商品動画 3 + 試着 2 で、目的・ショット数・秒数を持つ', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => `${t.id}:${t.goal}:${t.kind}:${t.shots}:${t.seconds}`)).toEqual(['pp-cutout-layout:photo:image:0:0', 'video-ec15:video:video:5:15', 'video-turntable12:video:video:4:12', 'video-short9:video:video:3:9', 'tryon-turntable12:video:video:4:12', 'tryon-images:tryon:image:0:0'])
    expect(WORKFLOW_TEMPLATES[1].build().nodes.length).toBe(5 + 4)
    expect(new Set(WORKFLOW_TEMPLATES.map((t) => t.id)).size).toBe(WORKFLOW_TEMPLATES.length)
  })
  it('商品写真の背景処理: Batch Input → Remove Background → Product Layout → Export（切り抜き 1 段の計画・App は撮影後工程）', () => {
    const c = buildPostProductionTemplate()
    expect(c.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['batch-input:batchInputNode', 'cutout:removeBackgroundNode', 'layout:productLayoutNode', 'export:exportNode'])
    expect(c.edges.map((e) => `${e.source}:${e.sourceHandle}→${e.target}:${e.targetHandle}`)).toEqual(['batch-input:out-image-image→cutout:in-image-image', 'cutout:out-cutout-cutout→layout:in-cutout-cutout', 'layout:out-image-image→export:in-image-0', 'batch-input:out-item-item→export:in-item-item'])
    const { tasks, warnings } = planTasks(c)
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}`)).toEqual(['cutout:cutout'])
    expect(appKindOf(c)).toBe('batch')
  })
})

describe('テンプレートから作成（試着・2b-4）', () => {
  const MODEL = (role: string) => `https://x.supabase.co/storage/v1/object/public/generated-images/library/u/${role}.jpg`
  // テンプレートはモデル未選択（ユーザーが Model ノードで選ぶ）。計画の確認用に Model ノードに向きごとのカットを入れる
  const cuts = Object.fromEntries(['front', 'right', 'back', 'left'].map((r) => [r, { itemId: r, url: MODEL(r) }]))
  const withModels = (c: TemplateCanvas): WorkflowSnapshot => ({
    nodes: c.nodes.map((n) => (n.data?.type === 'libraryModel' ? { ...n, data: { ...n.data, modelId: 'm1', modelName: 'モデル A', cuts } } : n)),
    edges: c.edges,
  })
  it('試着 → ターンテーブル: 服のカット ＋ Model → Try-On × 4（向きの予定）→ ショット × 4（Try-On の結果を始点・終点・回転の定型文）→ Video Merge → Export', () => {
    const c = buildTryOnTurntableTemplate()
    expect(c.nodes.map((n) => n.id)).toEqual(['cut-set', 'base-prompt', 'model', 'tryon-front', 'tryon-right', 'tryon-back', 'tryon-left', 'shot-1', 'shot-2', 'shot-3', 'shot-4', 'merge', 'export'])
    expect(c.nodes.filter((n) => n.data.type === 'tryOn').map((n) => `${n.data.label}:${n.data.params.role}:${n.data.model}`)).toEqual(['Try-On:front:null', 'Try-On:right:null', 'Try-On:back:null', 'Try-On:left:null'])
    expect(c.nodes[7].data.label).toBe('Video Generation')
    expect(c.nodes[2].data.label).toBe('Model')
    expect(c.nodes[7].data.params).toMatchObject({ autoTurn: false, negativePrompt: expect.stringContaining('背中を見せる') })
    expect(String(c.nodes[7].data.params.prompt)).toContain('4 分の 1 回転')
    expect(c.edges.filter((e) => e.target === 'tryon-right').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['cut-set:out-image-right→in-image-garment', 'model:out-image-right→in-image-model'])
    expect(c.edges.filter((e) => e.target === 'shot-1').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['tryon-front:out-image-image-out→in-image', 'tryon-right:out-image-image-out→in-image-end', 'base-prompt:out-text-text-out→in-text'])
    expect(c.edges.filter((e) => e.target === 'export').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['merge:out-video→in-video-v0', 'cut-set:out-item-item→in-item-item'])
    expect(new Set(c.edges.map((e) => e.id)).size).toBe(c.edges.length)
    // Model ノードが未選択のままだと Try-On は対象外（注意 4 つ）、動画も前段が無いので対象外
    const empty = planTasks(c)
    expect(empty.tasks).toEqual([])
    expect(empty.warnings.filter((w) => w.includes('モデルの画像が無い')).length).toBe(4)
    expect(Object.keys(empty.excluded).sort()).toEqual(['merge', 'shot-1', 'shot-2', 'shot-3', 'shot-4', 'tryon-back', 'tryon-front', 'tryon-left', 'tryon-right'])
    // モデルを入れると 試着 4 + ショット 4 + 結合 の計画になり、ショットは向きを引き継いで回転指示が付く
    const filled = withModels(c)
    const { tasks, warnings } = planTasks(filled)
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}`)).toEqual(['tryon-front:imageEdit:1', 'tryon-right:imageEdit:1', 'tryon-back:imageEdit:1', 'tryon-left:imageEdit:1', 'shot-1:videoShot:2', 'shot-2:videoShot:2', 'shot-3:videoShot:2', 'shot-4:videoShot:2', 'merge:videoMerge:3'])
    const shot1 = tasks.find((t) => t.nodeId === 'shot-1')!
    expect(shot1.inputs).toEqual({ start: { kind: 'dep', nodeId: 'tryon-front', prefer: 'result', role: 'front' }, end: { kind: 'dep', nodeId: 'tryon-right', prefer: 'result', role: 'right' } })
    expect(tasks[0].inputs.model).toEqual({ kind: 'asset', url: MODEL('front'), role: 'front' })
    expect(shot1.input.__shot).toMatchObject({ role: 'front', endRole: 'right', duration: 3 })
    expect(String(shot1.input.prompt)).toMatch(/quarter turn/)
    expect(shot1.input.cfg_scale).toBe(0.7)
    expect(shotsFromCanvas(filled).map((s) => `${s.role}>${s.endRole}`)).toEqual(['front>right', 'right>back', 'back>left', 'left>front'])
    expect(appKindOf(c)).toBe('video')
  })
  it('商品写真から着用画像: Batch Input ＋ Model → Try-On（正面）→ Export（画像とアイテム情報）', () => {
    const c = buildTryOnImagesTemplate()
    expect(c.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['batch-input:batchInputNode', 'model:libraryModelNode', 'tryon:tryOnNode', 'export:exportNode'])
    expect(c.edges.map((e) => `${e.source}:${e.sourceHandle}→${e.target}:${e.targetHandle}`)).toEqual(['batch-input:out-image-image→tryon:in-image-garment', 'model:out-image-front→tryon:in-image-model', 'tryon:out-image-image-out→export:in-image-0', 'batch-input:out-item-item→export:in-item-item'])
    expect(planTasks(c).warnings).toEqual(['Try-On（Try-On 正面）はモデルの画像が無いため一括実行の対象外です（Model ノードをつなぐか、参照画像のモデルタブから入れてください）'])   // 注意文・列名では向きの予定を添える
    const { tasks, warnings } = planTasks(withModels(c))
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}`)).toEqual(['tryon:imageEdit:1'])
    expect(appKindOf(c)).toBe('batch')
  })
})
