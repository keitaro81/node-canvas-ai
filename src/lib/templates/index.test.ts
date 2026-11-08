import { describe, it, expect } from 'vitest'
import { TURNTABLE_SINGLE_SECONDS, WORKFLOW_TEMPLATES, buildPostProductionTemplate, buildTryOnImagesTemplate, buildTurntableSingleTemplate, type TemplateCanvas } from './index'
import { planTasks, type WorkflowSnapshot } from '../batch/plan'
import { videoGenElements } from '../video/klingElement'
import { appKindOf, appScopeOf } from '../apps/appKind'

describe('テンプレートから作成（商品動画）', () => {
  it('ターンテーブル 1 本版（2026-11-08）: 参照画像（正面・背面）/ Text Prompt / Video Generation × 1 / Kling Element を読みやすい id で組み、最初から App 化。ノード名は種類名のまま', () => {
    const c = buildTurntableSingleTemplate()
    expect(c.capsuleGroupId).toBe('app-group')
    expect(c.nodes.map((n) => n.id)).toEqual(['app-group', 'ref-front', 'ref-back', 'base-prompt', 'shot-1', 'element'])
    expect(c.nodes.filter((n) => n.type === 'referenceImageNode').map((n) => `${n.data.label}:${n.data.photoHint}`)).toEqual(['Reference Image:正面', 'Reference Image:背面'])
    const shot = c.nodes.find((n) => n.id === 'shot-1')!
    expect(shot.data).toMatchObject({ label: 'Video Generation', model: 'kling-v3-pro', duration: String(TURNTABLE_SINGLE_SECONDS), aspectRatio: 'auto', audioEnabled: false, params: { autoTurn: false } })
    expect(String(shot.data.params.prompt).startsWith('@Element1\n')).toBe(true)      // 参照一式を指す印は欄の先頭に見える形で
    expect(String(shot.data.params.prompt)).toContain('一回転')
    expect(String(shot.data.params.negativePrompt)).toContain('逆回転')
    // 始点も終点も正面（一回転して元の向きに戻る）・文は Text Prompt から・参照一式は Kling Element（正面 + 背面）
    expect(c.edges.filter((e) => e.target === 'shot-1').map((e) => `${e.source}:${e.sourceHandle}→${e.targetHandle}`)).toEqual(['ref-front:out-image→in-image', 'ref-front:out-image→in-image-end', 'base-prompt:out-text-text-out→in-text', 'element:out-element-element→in-element-1'])
    expect(c.edges.filter((e) => e.target === 'element').map((e) => `${e.source}→${e.targetHandle}`)).toEqual(['ref-front→in-image-frontal', 'ref-back→in-image-ref1'])
    expect(new Set(c.edges.map((e) => e.id)).size).toBe(c.edges.length)
    const filledRefs = c.nodes.map((n) => (n.type === 'referenceImageNode' ? { ...n, data: { ...n.data, imageUrl: `https://x/${n.id}.jpg` } } : n))
    expect(videoGenElements(filledRefs, c.edges, 'shot-1').elements).toEqual([{ frontalUrl: 'https://x/ref-front.jpg', referenceUrls: ['https://x/ref-back.jpg'] }])
    // 一括の入口が無いので一括の計画は無い。App は「生成」（1 ステージの生成 App）
    expect(planTasks(c).tasks).toEqual([])
    expect(appKindOf(c)).toBe('generation')
  })
  it('一覧は 商品写真 1 + 商品動画 1 + 試着 1 で、目的・ショット数・秒数を持つ（EC 15 秒・ショート 9 秒・4 本結合・試着 → ターンテーブルは 2026-11-08 に外した）', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => `${t.id}:${t.goal}:${t.kind}:${t.shots}:${t.seconds}`)).toEqual(['pp-cutout-layout:photo:image:0:0', `video-turntable-single:video:video:1:${TURNTABLE_SINGLE_SECONDS}`, 'tryon-images:tryon:image:0:0'])
    expect(WORKFLOW_TEMPLATES[1].build().nodes.filter((n) => n.type === 'videoGenerationNode').length).toBe(1)
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
  it('商品写真から着用画像: Batch Input ＋ Model → Try-On（正面）→ Export（画像とアイテム情報）', () => {
    const c = buildTryOnImagesTemplate()
    expect(c.nodes.map((n) => `${n.id}:${n.type}`)).toEqual(['app-group:groupNode', 'batch-input:batchInputNode', 'model:libraryModelNode', 'tryon:tryOnNode', 'export:exportNode'])
    expect(appScopeOf(c)).toMatchObject({ kind: 'batch', groupId: 'app-group', entryId: 'batch-input' })
    expect(c.edges.map((e) => `${e.source}:${e.sourceHandle}→${e.target}:${e.targetHandle}`)).toEqual(['batch-input:out-image-image→tryon:in-image-garment', 'model:out-image-front→tryon:in-image-model', 'tryon:out-image-image-out→export:in-image-0', 'batch-input:out-item-item→export:in-item-item'])
    // Model ノードはつないであるがモデル未選択 → App は止めず「設定」で選べば動く（2026-11-07 メモ 68）
    const before = planTasks(c)
    expect(before.warnings).toEqual(['Try-On（Try-On 正面）はモデルが選ばれていないため、まだ処理できません（App の「設定」の Model か、キャンバスの Model ノードでモデルを選んでください）'])
    expect(before.pendingModel).toEqual(['tryon'])   // 注意文・列名では向きの予定を添える
    const { tasks, warnings } = planTasks(withModels(c))
    expect(warnings).toEqual([])
    expect(tasks.map((t) => `${t.nodeId}:${t.kind}:${t.stage}`)).toEqual(['tryon:imageEdit:1'])
    expect(appKindOf(c)).toBe('batch')
  })
})
