// Try-On ノード（2026-11-01・設計 docs/specs/library-tryon.md §4.1 / §7）: モデル画像 + 服の画像 → 着用画像。
// エンジンは Nano Banana 2 edit だけ（2b-1 の試作で最良・ユーザー決定「案 A」）。試着用の既定プロンプトはノードが持ち（src/lib/tryon/prompt.ts）、
// ユーザーは「服の説明・補足」（任意・日本語可 → 生成時に any-llm で英訳）だけ書く。
// モデルは in-image-model につなぐ（Model ノードの向きポート / 参照画像のモデルタブ / Cut Set Input / 別の Try-On）。ノード内の「モデル」ボタンは 2026-11-01 に廃止（旧ワークフローの data.model は読む）。
// 服は in-image-garment（Reference Image / Batch Input の写真 / Image Display / Remove Background の切り抜き）。
// 結果は Image Generation と同じく右に Image Display を作って出し、このノードの output（最新）にも入れる（後段の Video Generation 等につなげる）。
// 生成履歴（node_type 'try-on'）とライブラリの生成画像に入る。一括実行（2b-3）: Batch Input の写真をつなぐと写真ごとに 1 枚（計画は src/lib/batch/plan.ts・モデルは固定の画像として投入時にサーバーが署名）
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Handle, Position, type Edge, type NodeProps } from '@xyflow/react'
import { Shirt, Play, Loader2, UserRound, X } from 'lucide-react'
import { BaseNode } from './BaseNode'
import { useCanvasStore, type AppNode } from '../../stores/canvasStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSignedMedia } from '../../hooks/useSignedMedia'
import { useBatchSignedUrl } from '../../hooks/useBatchSignedUrl'
import { useLiveCanvas } from '../../hooks/useLiveCanvas'
import { showToast } from '../../hooks/useToast'
import { fal } from '../../lib/ai/fal-client'
import { toCanonicalRef, uploadImageFromUrl } from '../../lib/api/storage'
import { checkQuota, saveGeneration } from '../../lib/api/generations'
import { patchWorkflowNodeOutput } from '../../lib/api/workflows'
import { signLibraryUrl, touchLibraryItems } from '../../lib/api/library'
import { resolveFetchableUrl } from '../../lib/cutout/store'
import { ensureCutoutImage } from '../../lib/cutout/ensureCutout'
import { imageUrlFromNodeData } from '../../lib/cutout/upstream'
import { imageRoleOfSource, inputNodesOf, planTasksForNode, type SnapshotEdge, type SnapshotNode, type WorkflowSnapshot } from '../../lib/batch/plan'
import { textsNeedingTranslation } from '../../lib/video/translate'
import { translateTextsClient } from '../../lib/video/translateClient'
import { TRY_ON_ENDPOINT, TRY_ON_GARMENT_HANDLE, TRY_ON_MODEL_HANDLE, TRY_ON_OUTPUT_HANDLE, TRY_ON_RESOLUTIONS, buildTryOnInput, normalizeTryOnParams, tryOnPromptFromNote } from '../../lib/tryon/prompt'
import { CUT_ROLE_LABEL } from '../../lib/video/productVideo'
import type { CutoutRef, NodeData, TryOnModelRef, TryOnNodeData } from '../../types/nodes'

export { TRY_ON_GARMENT_HANDLE, TRY_ON_MODEL_HANDLE, TRY_ON_OUTPUT_HANDLE }
const ACCENT = '#8B5CF6'
const NODE_WIDTH = 280, H_GAP = 40, V_GAP = 10, DISPLAY_HEIGHT = 360
// 入力ポートは「モデル」「服」の行の横に置く（BaseNode の 1/3・2/3 配置だと服のポートが行から離れてつなぎにくい・2026-11-01 D1 の指摘）
const HEADER_H = 36, BODY_PAD = 12, ROW_H = 78, ROW_GAP = 8
const MODEL_PORT_TOP = HEADER_H + BODY_PAD + ROW_H / 2
const GARMENT_PORT_TOP = HEADER_H + BODY_PAD + ROW_H + ROW_GAP + ROW_H / 2
const completedDisplayIds = new Set<string>()   // 通常フローと復旧フローの二重登録を防ぐ（Image Generation と同じ）

const cutoutRefOf = (node: AppNode | undefined): CutoutRef | null => (node?.type === 'removeBackgroundNode' ? ((node.data as unknown as { output?: CutoutRef | null }).output ?? null) : null)
const labelOf = (node: AppNode | undefined, fallback: string): string => ((node?.data as { label?: string } | undefined)?.label || fallback)

/** 結果用の Image Display を右に作って出力に接続する（Image Generation と同じ配置: 既存の結果ノードの下に積む） */
function createResultNode(tryOnId: string): string | null {
  const { nodes: allNodes, edges: allEdges, addNode, setEdges } = useCanvasStore.getState()
  const thisNode = allNodes.find((n) => n.id === tryOnId)
  if (!thisNode) return null
  const existing = allEdges
    .filter((e) => e.source === tryOnId && e.sourceHandle === TRY_ON_OUTPUT_HANDLE)
    .map((e) => allNodes.find((n) => n.id === e.target))
    .filter((n): n is AppNode => n?.type === 'imageDisplayNode')
  const startY = existing.length > 0 ? Math.max(...existing.map((n) => n.position.y)) + DISPLAY_HEIGHT + V_GAP : thisNode.position.y
  const displayId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  addNode({
    id: displayId,
    type: 'imageDisplayNode',
    position: { x: thisNode.position.x + NODE_WIDTH + H_GAP, y: startY },
    data: { type: 'imageDisplay', label: 'Result', params: {}, status: 'generating', output: undefined } as NodeData,
    ...(thisNode.parentId ? { parentId: thisNode.parentId } : {}),
  } as AppNode)
  const { edges: latest } = useCanvasStore.getState()
  setEdges([...latest, { id: `e-tryon-${tryOnId}-disp-${displayId}`, source: tryOnId, sourceHandle: TRY_ON_OUTPUT_HANDLE, target: displayId, targetHandle: 'in-image-image-in', style: { stroke: ACCENT, strokeWidth: 2 }, animated: false, className: '' } as Edge])
  return displayId
}

/** 完了処理（通常フローと復旧フローで共通）: 表示 → 永続保存 → 履歴・サムネイル・ワークフローの出力 */
function finishResult(tryOnId: string, displayId: string, falUrl: string, meta: Record<string, unknown>) {
  const { updateNode } = useCanvasStore.getState()
  const workflowId = useWorkflowStore.getState().currentWorkflowId
  updateNode(displayId, { status: 'done', output: falUrl, requestId: null, requestEndpoint: null } as Partial<NodeData>)
  updateNode(tryOnId, { status: 'done', output: falUrl, progress: '', error: null } as Partial<NodeData>)
  void useWorkflowStore.getState().saveCurrentWorkflow()
  uploadImageFromUrl(falUrl, displayId).then(({ url: storedUrl, signedUrl }) => {
    const shown = signedUrl ?? storedUrl
    updateNode(displayId, { output: shown } as Partial<NodeData>)
    updateNode(tryOnId, { output: shown } as Partial<NodeData>)
    if (!completedDisplayIds.has(displayId)) {
      completedDisplayIds.add(displayId)
      void saveGeneration({ nodeId: displayId, nodeType: 'try-on', provider: 'fal', model: TRY_ON_ENDPOINT, status: 'completed', outputUrl: storedUrl, inputParams: meta })
      if (workflowId) void useWorkflowStore.getState().updateThumbnail(workflowId, storedUrl)
    }
    if (workflowId) {
      patchWorkflowNodeOutput(workflowId, displayId, { output: storedUrl }).catch(() => {})
      patchWorkflowNodeOutput(workflowId, tryOnId, { output: storedUrl }).catch(() => {})
    }
  }).catch(() => {
    showToast('着用画像の保存に失敗しました。一時 URL は期限切れになる可能性があります', 'warning')
  })
}

function SourceRow({ label, thumb, text, sub, placeholder, actions }: { label: string; thumb: string | null; text: string | null; sub?: string | null; placeholder: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md p-1.5" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
      <div className="shrink-0 rounded overflow-hidden flex items-center justify-center" style={{ width: 48, height: 64, background: 'var(--bg-placeholder)', color: 'var(--text-tertiary)' }}>
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" draggable={false} /> : placeholder}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
        <div className="text-[11px] truncate" style={{ color: text ? 'var(--text-primary)' : 'var(--text-tertiary)' }} title={text ?? ''}>{text ?? '未設定'}</div>
        {sub && <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>}
      </div>
      {actions}
    </div>
  )
}

function TryOnNodeInner(props: NodeProps) {
  const { id, data } = props
  const nodeData = data as unknown as TryOnNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const edges = useCanvasStore((s) => s.edges)
  const nodes = useCanvasStore((s) => s.nodes)
  const workflowId = useWorkflowStore((s) => s.currentWorkflowId)
  const params = normalizeTryOnParams(nodeData.params)
  const picked = nodeData.model ?? null
  const [busy, setBusy] = useState(false)

  // ── 上流（配線）──
  const modelEdge = edges.find((e) => e.target === id && e.targetHandle === TRY_ON_MODEL_HANDLE)
  const modelNode = modelEdge ? nodes.find((n) => n.id === modelEdge.source) : undefined
  const modelRaw = modelNode ? imageUrlFromNodeData(modelNode.data as Record<string, unknown>, modelEdge?.sourceHandle) : null
  const modelWiredRole = modelEdge ? imageRoleOfSource(nodes as unknown as SnapshotNode[], edges as unknown as SnapshotEdge[], modelEdge.source, modelEdge.sourceHandle) : null
  const { url: modelWiredThumb, freshUrl: modelFresh } = useSignedMedia(modelRaw, workflowId)

  const garmentEdge = edges.find((e) => e.target === id && e.targetHandle === TRY_ON_GARMENT_HANDLE)
  const garmentNode = garmentEdge ? nodes.find((n) => n.id === garmentEdge.source) : undefined
  const garmentCutout = cutoutRefOf(garmentNode)
  const garmentRaw = garmentNode && !garmentCutout ? imageUrlFromNodeData(garmentNode.data as Record<string, unknown>, garmentEdge?.sourceHandle) : null
  const { url: garmentWiredThumb, freshUrl: garmentFresh } = useSignedMedia(garmentRaw, workflowId)
  const garmentCutoutThumb = useBatchSignedUrl(garmentCutout?.previewPath)

  // ── ノード内で選んだモデル（配線が無いときに使う）: 保存形式の URL を表示用に署名 ──
  const [pickedThumb, setPickedThumb] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!picked?.url || modelNode) { setPickedThumb(null); return }
    signLibraryUrl(picked.url).then((u) => { if (alive) setPickedThumb(u !== picked.url ? u : null) }).catch(() => {})
    return () => { alive = false }
  }, [picked?.url, modelNode])

  const modelText = modelNode
    ? `${labelOf(modelNode, 'つないだ画像')}${modelWiredRole ? `・${CUT_ROLE_LABEL[modelWiredRole]}` : ''}`
    : picked ? `${picked.modelName ?? 'モデル'}${picked.role ? `・${CUT_ROLE_LABEL[picked.role]}` : ''}` : null
  const plannedRole = params.role ?? null   // 向きの予定（テンプレートが付ける）
  const modelSub = modelNode && picked ? '配線を優先（以前に選んだモデルは使いません）'
    : modelNode ? (modelWiredRole && plannedRole && modelWiredRole !== plannedRole ? `配線から（向きの予定は ${CUT_ROLE_LABEL[plannedRole]}）` : '配線から')
    : picked ? '以前にノードで選んだモデル（Model ノードをつなぐと置き換わります）'
    : plannedRole ? `向きの予定: ${CUT_ROLE_LABEL[plannedRole]}。Model ノードの${CUT_ROLE_LABEL[plannedRole]}をつなぐ` : 'Model ノードか参照画像（モデルタブ）をつなぐ'
  const garmentText = garmentNode ? (garmentCutout ? `${labelOf(garmentNode, 'Remove Background')}（切り抜き）` : labelOf(garmentNode, 'つないだ画像')) : null
  const hasModel = !!modelNode || !!picked
  const hasGarment = !!garmentNode
  const isRunning = nodeData.status === 'generating'

  // 一括実行の対象か（Batch Input / Cut Set Input があるキャンバスだけ・Video Generation と同じ表示）
  const live = useLiveCanvas()
  const batchInfo = useMemo(() => {
    const snap = live as unknown as WorkflowSnapshot
    const ins = inputNodesOf(snap)
    if (!ins.batchInputId && !ins.cutSetInputId) return null
    const { tasks, excluded } = planTasksForNode(snap, id)   // 自分の入口の枝だけで計画（メモ 24）
    const t = tasks.find((x) => x.nodeId === id)
    if (t) return { ok: true as const, stage: t.stage, reason: null }
    return { ok: false as const, stage: 0, reason: excluded[id] ?? null }
  }, [live, id])

  const setParams = useCallback((patch: Partial<typeof params>) => updateNode(id, { params: { ...params, ...patch } }), [id, params, updateNode])


  // ── 実行 ──
  const handleRun = useCallback(async () => {
    if (busy) return
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState()
    const mEdge = allEdges.find((e) => e.target === id && e.targetHandle === TRY_ON_MODEL_HANDLE)
    const gEdge = allEdges.find((e) => e.target === id && e.targetHandle === TRY_ON_GARMENT_HANDLE)
    const mNode = mEdge ? allNodes.find((n) => n.id === mEdge.source) : undefined
    const gNode = gEdge ? allNodes.find((n) => n.id === gEdge.source) : undefined
    if (!mNode && !picked) { showToast('モデルの画像をつないでください（Model ノードの向きのポート、または参照画像のモデルタブ）', 'warning'); return }
    if (!gNode) { showToast('服の画像をつないでください', 'warning'); return }
    setBusy(true)
    updateNode(id, { status: 'generating', progress: '準備中…', error: null } as Partial<NodeData>)
    let displayId: string | null = null
    try {
      const quota = await checkQuota('image')
      if (!quota.allowed) throw new Error(`画像生成の上限（${quota.limit}枚）に達しました（${quota.used}/${quota.limit}枚使用済み）`)

      // モデル画像（fal が取りに行ける URL）
      let modelUrl: string
      let modelRole: TryOnModelRef['role'] = null
      if (mNode) {
        const raw = imageUrlFromNodeData(mNode.data as Record<string, unknown>, mEdge?.sourceHandle)
        if (!raw) throw new Error(`${labelOf(mNode, 'モデル')} に画像がありません`)
        if (raw.startsWith('blob:') || raw.startsWith('data:')) throw new Error('モデル画像のアップロード完了を待ってから実行してください')
        modelUrl = await resolveFetchableUrl({ canonical: toCanonicalRef(raw) ?? raw, fresh: modelFresh, liveUrl: raw })
        modelRole = mEdge ? imageRoleOfSource(allNodes as unknown as SnapshotNode[], allEdges as unknown as SnapshotEdge[], mEdge.source, mEdge.sourceHandle) : null
      } else {
        const ref = picked!
        modelUrl = await signLibraryUrl(ref.url)
        if (modelUrl === ref.url) throw new Error('モデルの写真を取得できません（ライブラリから消えたか、共有が外れた可能性があります）')
        modelRole = ref.role
        void touchLibraryItems([ref.itemId])   // 最終利用の記録（最善努力）
      }

      // 服の画像
      let garmentUrl: string
      const cut = cutoutRefOf(gNode)
      if (gNode.type === 'removeBackgroundNode') {
        const label = labelOf(gNode, 'Remove Background')
        if (!cut) throw new Error(`${label} を先に実行してください（切り抜き画像を服の入力にします）`)
        // 透過画像が無い古い結果はその場で作って保存する（fal は呼ばない）
        updateNode(id, { progress: '切り抜き画像を用意中…' } as Partial<NodeData>)
        const ensured = await ensureCutoutImage(cut, gNode.id, useWorkflowStore.getState().currentWorkflowId, imageUrlFromNodeData(gNode.data as Record<string, unknown>))
        if (ensured.ref !== cut) updateNode(gNode.id, { output: ensured.ref } as Partial<NodeData>)
        garmentUrl = ensured.signedUrl
      } else {
        const raw = imageUrlFromNodeData(gNode.data as Record<string, unknown>, gEdge?.sourceHandle)
        if (!raw) throw new Error(`${labelOf(gNode, '服')} に画像がありません`)
        if (raw.startsWith('blob:') || raw.startsWith('data:')) throw new Error('服の画像のアップロード完了を待ってから実行してください')
        garmentUrl = await resolveFetchableUrl({ canonical: toCanonicalRef(raw) ?? raw, fresh: garmentFresh, liveUrl: raw })
      }

      // プロンプト（服の説明・補足が日本語なら英訳）
      const note = params.note
      let translations: Record<string, string> = {}
      const needs = textsNeedingTranslation([note])
      if (needs.length) { updateNode(id, { progress: '日本語を英訳中…' } as Partial<NodeData>); translations = await translateTextsClient(needs) }
      const prompt = tryOnPromptFromNote(note, translations)

      displayId = createResultNode(id)
      updateNode(id, { progress: '試着中…' } as Partial<NodeData>)
      const result = await fal.subscribe(TRY_ON_ENDPOINT, {
        input: { ...buildTryOnInput(prompt, params), image_urls: [modelUrl, garmentUrl] },
        logs: false,
        onEnqueue: (requestId: string) => {
          if (displayId) updateNode(displayId, { requestId, requestEndpoint: TRY_ON_ENDPOINT } as Partial<NodeData>)
          void useWorkflowStore.getState().saveCurrentWorkflow()   // 再読み込み後に復旧できるように
        },
      })
      const out = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
      if (!out) throw new Error('着用画像が返りませんでした')
      finishResult(id, displayId!, out, { prompt, note, resolution: params.resolution, modelItemId: mNode ? null : picked?.itemId ?? null, modelRole })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      updateNode(id, { status: 'error', progress: '', error: message } as Partial<NodeData>)
      if (displayId) {
        updateNode(displayId, { status: 'error', params: { error: message }, requestId: null, requestEndpoint: null } as Partial<NodeData>)
        void saveGeneration({ nodeId: displayId, nodeType: 'try-on', provider: 'fal', model: TRY_ON_ENDPOINT, status: 'failed', errorMessage: message, inputParams: {} })
      }
    } finally {
      setBusy(false)
    }
  }, [busy, id, picked, params, updateNode, modelFresh, garmentFresh])

  // ── 再読み込み後の復旧（Image Generation と同じ: 結果ノードに requestId が残っていれば結果を取りに行く）──
  const recovering = useRef(false)
  useEffect(() => {
    if (recovering.current) return
    const { nodes: allNodes, edges: allEdges } = useCanvasStore.getState()
    const targets = allEdges
      .filter((e) => e.source === id && e.sourceHandle === TRY_ON_OUTPUT_HANDLE)
      .flatMap((e) => {
        const d = allNodes.find((n) => n.id === e.target)?.data as Record<string, unknown> | undefined
        if (!d || d.status !== 'generating' || typeof d.requestId !== 'string' || typeof d.requestEndpoint !== 'string') return []
        return [{ displayId: e.target, requestId: d.requestId, endpoint: d.requestEndpoint }]
      })
    if (!targets.length) return
    recovering.current = true
    updateNode(id, { status: 'generating', progress: '結果を取得中…', error: null } as Partial<NodeData>)
    ;(async () => {
      for (const t of targets) {
        try {
          await fal.queue.subscribeToStatus(t.endpoint, { requestId: t.requestId, logs: false, mode: 'polling', pollInterval: 3000 })
          const result = await fal.queue.result(t.endpoint, { requestId: t.requestId })
          const out = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url
          if (!out) throw new Error('着用画像が返りませんでした')
          finishResult(id, t.displayId, out, { recovered: true })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          updateNode(t.displayId, { status: 'error', params: { error: message }, requestId: null, requestEndpoint: null } as Partial<NodeData>)
          updateNode(id, { status: 'error', progress: '', error: message } as Partial<NodeData>)
        }
      }
      recovering.current = false
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <BaseNode
      {...props}
      data={nodeData as unknown as NodeData}
      icon={<Shirt size={14} />}
      hideStatus
      inputs={[]}
      outputs={[{ id: 'image-out', portType: 'image', label: '着用画像' }]}
    >
      <Handle id={TRY_ON_MODEL_HANDLE} type="target" position={Position.Left} className="handle-image" title="モデル画像（Model ノードの向き / 参照画像 / Cut Set Input）" style={{ top: MODEL_PORT_TOP, width: 20, height: 20 }} />
      <span className="absolute pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded" style={{ top: MODEL_PORT_TOP, right: 'calc(100% + 8px)', transform: 'translateY(-50%)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', zIndex: 5 }}>モデル</span>
      <Handle id={TRY_ON_GARMENT_HANDLE} type="target" position={Position.Left} className="handle-image" title="服の画像（商品写真 / 切り抜き / 参照画像）" style={{ top: GARMENT_PORT_TOP, width: 20, height: 20 }} />
      <span className="absolute pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded" style={{ top: GARMENT_PORT_TOP, right: 'calc(100% + 8px)', transform: 'translateY(-50%)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', zIndex: 5 }}>服</span>
      <div className="flex flex-col gap-2 nodrag">
        <SourceRow
          label="モデル（左のポート・上）"
          thumb={modelNode ? (modelWiredThumb ?? null) : pickedThumb}
          text={modelText}
          sub={modelSub}
          placeholder={<UserRound size={18} />}
          actions={picked && !modelNode ? (
            <button className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-elevated)] shrink-0" style={{ color: 'var(--text-tertiary)' }} title="以前に選んだモデルを外す" onClick={() => updateNode(id, { model: null } as Partial<NodeData>)} disabled={isRunning}><X size={12} /></button>
          ) : undefined}
        />
        <SourceRow
          label="服（左のポート・下）"
          thumb={garmentCutout ? garmentCutoutThumb : (garmentWiredThumb ?? null)}
          text={garmentText}
          sub={garmentNode ? (garmentCutout ? '切り抜き画像を使う' : '配線から') : '商品写真・切り抜き・参照画像をつなぐ'}
          placeholder={<Shirt size={18} />}
        />

        {/* 設定 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>解像度</span>
          <div className="flex gap-1">
            {TRY_ON_RESOLUTIONS.map((r) => (
              <button key={r} className="h-6 px-2 rounded text-[11px] transition-colors" style={{ background: params.resolution === r ? ACCENT : 'var(--bg-canvas)', color: params.resolution === r ? '#fff' : 'var(--text-secondary)', border: `1px solid ${params.resolution === r ? ACCENT : 'var(--border)'}` }} onClick={() => setParams({ resolution: r })} disabled={isRunning}>{r}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>服の説明・補足（任意・日本語可）</span>
          <textarea
            className="w-full rounded-md px-2.5 py-2 text-[12px] leading-relaxed resize-y focus:outline-none"
            style={{ minHeight: 56, background: 'var(--bg-canvas)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            placeholder="例: ニットカーディガン。ボタンは開けたまま"
            value={params.note}
            onChange={(e) => setParams({ note: e.target.value })}
            disabled={isRunning}
          />
        </div>

        {batchInfo && (
          <div className="text-[10px] leading-snug px-2 py-1 rounded" style={{ background: batchInfo.ok ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)', color: batchInfo.ok ? '#22C55E' : '#F59E0B' }}>
            {batchInfo.ok ? `一括実行: 対象（${batchInfo.stage} 段目・写真ごとに 1 枚）` : `一括実行: 対象外（${batchInfo.reason ?? '写真由来の入力（Batch Input / Cut Set Input / 前段の AI ノード）がありません'}）`}
          </div>
        )}

        <button
          className="w-full h-9 rounded-lg flex items-center justify-center gap-1.5 text-[12px] font-medium text-white transition-all duration-150 disabled:opacity-50"
          style={{ background: ACCENT }}
          onClick={() => void handleRun()}
          disabled={isRunning || busy || !hasModel || !hasGarment}
          title={!hasModel ? 'Model ノードか参照画像のモデルタブからモデルをつないでください' : !hasGarment ? '服の画像をつないでください' : 'Nano Banana 2 で着用画像を 1 枚作ります（約 $0.04）'}
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {isRunning ? (nodeData.progress || '試着中…') : '試着（Nano Banana 2）'}
        </button>
        {nodeData.status === 'error' && nodeData.error && <div className="text-[11px] break-words" style={{ color: '#EF4444' }}>{nodeData.error}</div>}
        <div className="text-[10px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>服の写真と同じ向きのモデルをつなぐと側面・背面も作れます。結果は右の Image Display に出て、生成履歴とライブラリの生成画像にも入ります。Batch Input の写真をつなぐと一括実行で写真ごとに作れます。</div>
      </div>
    </BaseNode>
  )
}

export const TryOnNode = memo(TryOnNodeInner)
