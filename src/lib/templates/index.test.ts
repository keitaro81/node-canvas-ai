import { describe, it, expect } from 'vitest'
import { WORKFLOW_TEMPLATES, buildPostProductionTemplate, buildProductVideoTemplate, buildTryOnImagesTemplate, buildTryOnTurntableTemplate, type TemplateCanvas } from './index'
import { autoElementSources, planTasks, type WorkflowSnapshot } from '../batch/plan'
import { appKindOf, appScopeOf } from '../apps/appKind'

describe('テンプレートから作成（商品動画）', () => {
  it('ターンテーブル: 参照画像（向き）× 4 / Text Prompt / Video Generation × 4 / Video Merge / Export を読みやすい id で組み、ノード名は種類名のまま', () => {
    const c = buildProductVideoTemplate('turntable12')
    expect(c.nodes.map((n) => n.id)).toEqual(['ref-front', 'ref-right', 'ref-back', 'ref-left', 'base-prompt', 'shot-1', 'shot-2', 'shot-3', 'shot-4', 'merge', 'export'])
    expect(c.nodes.filter((n) => n.type === 'referenceImageNode').map((n) => `${n.data.label}:${n.data.role}`)).toEqual(['Reference Image:front', 'Reference Image:right', 'Reference Image:back', 'Reference Image:left'])
    expect(c.nodes[5].data).toMatchObject({ label: 'Video Generation', model: 'kling-v3-pro', aspectRatio: 'auto', params: { autoTurn: false } })
    expect(String(c.nodes[5].data.params.prompt)).toContain('4 分の 1 回転')
    expect(c.edges.filter((e) => e.target === 'shot-1').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['ref-front:out-image→in-image', 'ref-right:out-image→in-image-end', 'base-prompt:out-text-text-out→in-text'])
    expect(c.edges.filter((e) => e.target === 'export').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['merge:out-video→in-video-v0'])
    expect(new Set(c.edges.map((e) => e.id)).size).toBe(c.edges.length)
    // Kling の参照一式は兄弟ショットの向きから自動（正面 + 右・左・背面）
    expect(autoElementSources(c.nodes, c.edges, 'shot-2').map((x) => x.role)).toEqual(['front', 'right', 'left', 'back'])
    // 一括の入口が無いので一括の計画は無く、App にもならない（商品ごとに対話実行）
    expect(planTasks(c).tasks).toEqual([])
    expect(appKindOf(c)).toBeNull()
  })
  it('一覧は 商品写真 1 + 商品動画 3 + 試着 2 で、目的・ショット数・秒数を持つ', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => `${t.id}:${t.goal}:${t.kind}:${t.shots}:${t.seconds}`)).toEqual(['pp-cutout-layout:photo:image:0:0', 'video-ec15:video:video:5:15', 'video-turntable12:video:video:4:12', 'video-short9:video:video:3:9', 'tryon-turntable12:video:video:4:12', 'tryon-images:tryon:image:0:0'])
    expect(WORKFLOW_TEMPLATES[1].build().nodes.filter((n) => n.type === 'videoGenerationNode').length).toBe(5)
    expect(new Set(WORKFLOW_TEMPLATES.map((t) => t.id)).size).toBe(WORKFLOW_TEMPLATES.length)
  })
  it('商品写真の背景処理: Batch Input → Remove Background → Product Layout → Export（切り抜き 1 段の計画・App は撮影後工程）。最初からグループに入れて App 化（2026-11-02）', () => {
    const c = buildPostProductionTemplate()
    expect(c.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['app-group:groupNode', 'batch-input:batchInputNode', 'cutout:removeBackgroundNode', 'layout:productLayoutNode', 'export:exportNode'])
    expect(c.capsuleGroupId).toBe('app-group')
    expect(c.nodes[0].data).toEqual({ label: 'Group', capsuleEnabled: true })
    expect(c.nodes.slice(1).map((n) => (n as { parentId?: string }).parentId)).toEqual(['app-group', 'app-group', 'app-group', 'app-group'])
    expect(c.nodes[1].position).toEqual({ x: 40, y: 68 })   // グループからの相対位置（余白 40・見出し 28）
    expect(appScopeOf(c)).toEqual({ kind: 'batch', groupId: 'app-group', entryId: 'batch-input', entryCount: 1 })
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
  it('試着 → ターンテーブル: 服の参照画像（向き）× 4 ＋ Model → Try-On × 4 → Video Generation × 4 → Video Merge → Export（ノード名は種類名）', () => {
    const c = buildTryOnTurntableTemplate()
    expect(c.nodes.map((n) => n.id)).toEqual(['garment-front', 'garment-right', 'garment-back', 'garment-left', 'model', 'tryon-front', 'tryon-right', 'tryon-back', 'tryon-left', 'base-prompt', 'shot-1', 'shot-2', 'shot-3', 'shot-4', 'merge', 'export'])
    expect(c.nodes.filter((n) => n.data.type === 'tryOn').map((n) => `${n.data.label}:${n.data.params.role}`)).toEqual(['Try-On:front', 'Try-On:right', 'Try-On:back', 'Try-On:left'])
    expect(c.edges.filter((e) => e.target === 'tryon-right').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['garment-right:out-image→in-image-garment', 'model:out-image-right→in-image-model'])
    expect(c.edges.filter((e) => e.target === 'shot-1').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['tryon-front:out-image-image-out→in-image', 'tryon-right:out-image-image-out→in-image-end', 'base-prompt:out-text-text-out→in-text'])
    expect(new Set(c.edges.map((e) => e.id)).size).toBe(c.edges.length)
    // Try-On の結果は Model の向きを持ち、ショットの参照一式は試着結果から自動
    const filled = withModels(c)
    expect(autoElementSources(filled.nodes!, filled.edges!, 'shot-1').map((x) => `${x.role}:${x.source}`)).toEqual(['front:tryon-front', 'right:tryon-right', 'left:tryon-left', 'back:tryon-back'])
    expect(planTasks(filled).tasks).toEqual([])   // 一括の入口が無い（対話実行で作る）
    expect(appKindOf(c)).toBeNull()
  })
  it('商品写真から着用画像: Batch Input ＋ Model → Try-On（正面）→ Export（画像とアイテム情報）', () => {
    const c = buildTryOnImagesTemplate()
    expect(c.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['app-group:groupNode', 'batch-input:batchInputNode', 'model:libraryModelNode', 'tryon:tryOnNode', 'export:exportNode'])
    expect(appScopeOf(c)).toMatchObject({ kind: 'batch', groupId: 'app-group', entryId: 'batch-input' })
    expect(c.edges.map((e) => `${e.source}:${e.sourceHandle}→${e.target}:${e.targetHandle}`)).toEqual(['batch-input:out-image-image→tryon:in-image-garment', 'model:out-image-front→tryon:in-image-model', 'tryon:out-image-image-out→export:in-image-0', 'batch-input:out-item-item→export:in-item-item'])
    expect(planTasks(c).warnings).toEqual(['Try-On（Try-On 正面）はモデルの画像が無いため一括実行の対象外です（Model ノードをつなぐか、参照画像のモデルタブから入れてください）'])   // 注意文・列名では向きの予定を添える
    const { tasks, warnings } = planTasks(withModels(c))
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}`)).toEqual(['tryon:imageEdit:1'])
    expect(appKindOf(c)).toBe('batch')
  })
})
