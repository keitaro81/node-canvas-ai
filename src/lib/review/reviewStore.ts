// ReviewGrid の状態（仕様 5 章 / 4-9 / 4-10）。
// - サムネイルは識別値（layoutHash）で管理: 記録済みなら Storage から、無ければ実行者（Worker）で描いて保存・記録する
// - 同時に描くのは 1 アイテムだけ。画面側は長辺 400px のサムネイル（object URL）しか持たない
import { create } from 'zustand'
import type { CutoutParams } from '../../types/nodes'
import type { BatchItemRow, BatchOutputRow, BatchTaskRow } from '../../types/batch'
import { layoutHash, layoutIdentityString, type LayoutIdentityInput } from '../layout/identity'
import { signBatchPaths, uploadBatchObject } from '../cutout/store'
import { recordThumb } from '../api/batchJobs'
import { CancelledError, createLayoutExecutor, type LayoutExecutor } from './executor'
import { CUTOUT_PREVIEW_PARAMS, CUTOUT_VARIANT_KEY, THUMB_MAX_EDGE, cutoutParamsOf, identityFor, resultKindOf, thumbFileName, thumbKey, type GridSelection, type ReviewFilter, type ReviewVariant } from './model'
import type { FullResult, ThumbResult } from './renderCore'

export type ReviewBg = 'white' | 'gray' | 'checker'
export type ThumbStatus = 'waiting' | 'queued' | 'rendering' | 'ready' | 'error' | 'failed'

export interface ThumbState {
  status: ThumbStatus
  url: string | null
  hash: string | null
  warnings: string[]
  transparent: boolean
  scale: number | null
  error?: string
}

export interface ReviewContext {
  teamId: string
  jobId: string
  items: BatchItemRow[]
  tasks: BatchTaskRow[]
  variants: ReviewVariant[]
  cutoutNodeId: string | null
  cutoutParams: CutoutParams            // 写しの切り抜き設定（タスクに __params があればそちら）
  knownThumbs: BatchOutputRow[]
  backgroundUrls: Record<string, string> // 背景画像ノード ID → 署名 URL（Step 8）
}

export interface ItemRenderable {
  item: BatchItemRow
  task: BatchTaskRow
  cutout: CutoutParams
}

interface ReviewState {
  jobId: string | null
  bg: ReviewBg
  filter: ReviewFilter
  selection: GridSelection | null
  lightbox: { itemId: string; variantKey: string } | null
  thumbs: Record<string, ThumbState>
  progress: { done: number; total: number; running: boolean }
  executorKind: 'worker' | 'main' | null
  open: (jobId: string) => void
  close: () => void
  setBg: (bg: ReviewBg) => void
  setFilter: (f: ReviewFilter) => void
  setSelection: (s: GridSelection | null) => void
  setLightbox: (l: { itemId: string; variantKey: string } | null) => void
  sync: (ctx: ReviewContext) => Promise<void>
  renderFull: (itemId: string, variantKey: string) => Promise<FullResult>
  getExecutor: () => LayoutExecutor
}

// ── モジュール内の作業状態（React の再描画に関係ないもの） ──
let executor: LayoutExecutor | null = null
let ctxRef: ReviewContext | null = null
let queue: string[] = []                       // 描画待ちのアイテム ID（表示順）
let pumping = false
let syncGen = 0
const hashCache = new Map<string, string>()    // identityString → hash
const objectUrls = new Map<string, string>()   // thumbKey → object URL（差し替え時に revoke）
let persistInFlight = 0
const persistQueue: Array<() => Promise<void>> = []

function getExecutorImpl(): LayoutExecutor {
  if (!executor) executor = createLayoutExecutor()
  return executor
}

async function hashOf(input: LayoutIdentityInput): Promise<string> {
  const id = layoutIdentityString(input)
  const cached = hashCache.get(id)
  if (cached) return cached
  const h = await layoutHash(input)
  hashCache.set(id, h)
  return h
}

/** アイテムが描画可能か（準備完了・切り抜きタスク完了・結果ファイルあり） */
export function renderableOf(ctx: ReviewContext, item: BatchItemRow): ItemRenderable | null {
  if (!ctx.cutoutNodeId) return null
  const task = ctx.tasks.find((t) => t.item_id === item.id && t.node_id === ctx.cutoutNodeId)
  if (!task || task.status !== 'completed' || !task.result_path || item.status !== 'ready') return null
  return { item, task, cutout: cutoutParamsOf(task, ctx.cutoutParams) }
}

function variantKeys(ctx: ReviewContext): string[] {
  return [CUTOUT_VARIANT_KEY, ...ctx.variants.map((v) => v.key)]
}

function identityOf(ctx: ReviewContext, r: ItemRenderable, key: string): LayoutIdentityInput {
  const v = ctx.variants.find((x) => x.key === key)
  const params = key === CUTOUT_VARIANT_KEY || !v ? CUTOUT_PREVIEW_PARAMS : v.params
  const backgroundRef = v?.backgroundNodeId ? (ctx.backgroundUrls[v.backgroundNodeId] ? `node:${v.backgroundNodeId}` : null) : null
  return identityFor({ item: r.item, task: r.task, cutout: r.cutout, params, backgroundRef })
}

function setThumbUrl(key: string, url: string | null): void {
  const prev = objectUrls.get(key)
  if (prev && prev !== url) { URL.revokeObjectURL(prev); objectUrls.delete(key) }
  if (url && url.startsWith('blob:')) objectUrls.set(key, url)
}

function enqueuePersist(fn: () => Promise<void>): void {
  persistQueue.push(fn)
  const pump = () => {
    while (persistInFlight < 2 && persistQueue.length) {
      const job = persistQueue.shift()!
      persistInFlight++
      job().catch((e) => console.warn('[review] thumb persist failed:', e)).finally(() => { persistInFlight--; pump() })
    }
  }
  pump()
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  jobId: null,
  bg: 'checker',
  filter: 'all',
  selection: null,
  lightbox: null,
  thumbs: {},
  progress: { done: 0, total: 0, running: false },
  executorKind: null,

  open: (jobId) => {
    if (get().jobId === jobId) return
    get().close()
    set({ jobId, executorKind: getExecutorImpl().kind })
  },

  close: () => {
    syncGen++
    queue = []
    ctxRef = null
    executor?.cancelAll()
    for (const u of objectUrls.values()) URL.revokeObjectURL(u)
    objectUrls.clear()
    set({ jobId: null, thumbs: {}, selection: null, lightbox: null, progress: { done: 0, total: 0, running: false } })
  },

  setBg: (bg) => set({ bg }),
  setFilter: (filter) => set({ filter, selection: null }),
  setSelection: (selection) => set({ selection }),
  setLightbox: (lightbox) => set({ lightbox }),
  getExecutor: () => getExecutorImpl(),

  /**
   * 文脈（アイテム・タスク・バリアント・記録済みサムネイル）を受け取り、各タイルの望ましい識別値を出して
   * 「記録済みなら署名して表示」「無ければ描画待ちに積む」を決める。差分だけを更新する。
   */
  sync: async (ctx) => {
    ctxRef = ctx
    const gen = ++syncGen
    const keys = variantKeys(ctx)
    const next: Record<string, ThumbState> = { ...get().thumbs }
    const toSign: Array<{ key: string; path: string; hash: string; transparent: boolean }> = []
    const needRender = new Set<string>()
    const known = new Map<string, BatchOutputRow>()
    for (const o of ctx.knownThumbs) known.set(`${o.item_id}|${o.variant}|${o.layout_hash}`, o)

    for (const item of ctx.items) {
      const r = renderableOf(ctx, item)
      for (const key of keys) {
        const tk = thumbKey(item.id, key)
        const cur = next[tk]
        if (!r) {
          const failed = item.status === 'failed'
          if (cur?.status !== (failed ? 'failed' : 'waiting')) {
            setThumbUrl(tk, null)
            next[tk] = { status: failed ? 'failed' : 'waiting', url: null, hash: null, warnings: [], transparent: key === CUTOUT_VARIANT_KEY, scale: null, error: failed ? (item.warnings[0] ?? '処理に失敗しました') : undefined }
          }
          continue
        }
        const hash = await hashOf(identityOf(ctx, r, key))
        if (gen !== syncGen) return
        if (cur && cur.hash === hash && (cur.status === 'ready' || cur.status === 'rendering' || cur.status === 'queued')) continue
        const rec = known.get(`${item.id}|${key}|${hash}`)
        const v = ctx.variants.find((x) => x.key === key)
        const transparent = key === CUTOUT_VARIANT_KEY || v?.params.backgroundKind === 'transparent'
        if (rec) {
          toSign.push({ key: tk, path: rec.output_path, hash, transparent })
          next[tk] = { status: 'queued', url: cur?.url ?? null, hash, warnings: cur?.warnings ?? [], transparent, scale: cur?.scale ?? null }
        } else {
          next[tk] = { status: 'queued', url: cur?.url ?? null, hash, warnings: [], transparent, scale: null }
          needRender.add(item.id)
        }
      }
    }
    // 記録済みサムネイルの署名（まとめて 1 回）
    if (toSign.length) {
      const map = await signBatchPaths(toSign.map((t) => t.path)).catch(() => ({} as Record<string, string>))
      if (gen !== syncGen) return
      for (const t of toSign) {
        const url = map[t.path]
        if (url) { setThumbUrl(t.key, null); next[t.key] = { ...next[t.key], status: 'ready', url, hash: t.hash } }
        else {
          // 記録はあるがファイルを取れない → 描き直す
          const itemId = t.key.split('|')[0]
          needRender.add(itemId)
        }
      }
    }
    // 順序は表示順（items の順）
    const order = ctx.items.map((i) => i.id)
    const pendingItems = order.filter((id) => needRender.has(id))
    queue = [...pendingItems, ...queue.filter((id) => !needRender.has(id) && order.includes(id))]
    const totalTiles = Object.values(next).filter((t) => t.status !== 'waiting' && t.status !== 'failed').length
    const doneTiles = Object.values(next).filter((t) => t.status === 'ready').length
    set({ thumbs: next, progress: { done: doneTiles, total: totalTiles, running: queue.length > 0 || pumping } })
    void pump()
  },

  renderFull: async (itemId, variantKey) => {
    const ctx = ctxRef
    if (!ctx) throw new Error('ジョブが開かれていません')
    const item = ctx.items.find((i) => i.id === itemId)
    const r = item ? renderableOf(ctx, item) : null
    if (!r) throw new Error('このアイテムはまだ描画できません')
    const assets = await assetsFor(r)
    const v = ctx.variants.find((x) => x.key === variantKey)
    const spec = variantKey === CUTOUT_VARIANT_KEY || !v
      ? { key: CUTOUT_VARIANT_KEY, params: CUTOUT_PREVIEW_PARAMS }
      : { key: v.key, params: v.params, backgroundUrl: v.backgroundNodeId ? ctx.backgroundUrls[v.backgroundNodeId] ?? null : null }
    let out: FullResult | null = null
    await getExecutorImpl().renderFull({ assets, cutout: r.cutout, variants: [spec] }, (res) => { out = res })
    if (!out) throw new Error('描画結果がありません')
    return out
  },
}))

/** 元画像と結果ファイルの署名 URL（実行者に渡す。Worker は署名 URL だけを受け取る） */
async function assetsFor(r: ItemRenderable) {
  const originalPath = r.item.source_path ?? r.item.interactive_path
  if (!originalPath || !r.task.result_path) throw new Error('元画像または結果ファイルがありません')
  const map = await signBatchPaths([originalPath, r.task.result_path])
  const originalUrl = map[originalPath], resultUrl = map[r.task.result_path]
  if (!originalUrl || !resultUrl) throw new Error('画像の署名に失敗しました（チームの権限を確認してください）')
  return { originalUrl, resultUrl, resultKind: resultKindOf(r.task) }
}

/**
 * 描画待ちを 1 アイテムずつ処理する。sync が途中で走っても止めない（毎回最新の文脈と「queued」の印を見る）。
 * 描画中に識別値が変わったタイルは、結果を捨てて次の周回で描き直す。
 */
async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length) {
      const ctx = ctxRef
      if (!ctx) break
      const itemId = queue.shift()!
      const item = ctx.items.find((i) => i.id === itemId)
      const r = item ? renderableOf(ctx, item) : null
      if (!r) continue
      const st = useReviewStore.getState()
      const keys = variantKeys(ctx).filter((k) => st.thumbs[thumbKey(itemId, k)]?.status === 'queued')
      if (!keys.length) continue
      const mark = (status: ThumbStatus, patch: Partial<ThumbState> = {}) => {
        const cur = useReviewStore.getState().thumbs
        const t = { ...cur }
        for (const k of keys) { const tk = thumbKey(itemId, k); if (t[tk]) t[tk] = { ...t[tk], status, ...patch } }
        useReviewStore.setState({ thumbs: t })
      }
      const expected: Record<string, string | null> = {}
      for (const k of keys) expected[k] = st.thumbs[thumbKey(itemId, k)]?.hash ?? null
      mark('rendering')
      try {
        const assets = await assetsFor(r)
        const variants = ctx.variants
          .filter((v) => keys.includes(v.key))
          .map((v) => ({ key: v.key, params: v.params, backgroundUrl: v.backgroundNodeId ? ctx.backgroundUrls[v.backgroundNodeId] ?? null : null }))
        await getExecutorImpl().renderThumbs(
          { assets, cutout: r.cutout, variants, thumbMaxEdge: THUMB_MAX_EDGE, includeCutout: keys.includes(CUTOUT_VARIANT_KEY) },
          (t: ThumbResult) => onThumb(ctx, itemId, t, expected[t.key] ?? null),
        )
        // 描画中に識別値が変わったタイルは queued のまま残るので、同じアイテムをもう一度並べる
        const after = useReviewStore.getState().thumbs
        if (keys.some((k) => after[thumbKey(itemId, k)]?.status === 'rendering')) {
          const t = { ...after }
          for (const k of keys) { const tk = thumbKey(itemId, k); if (t[tk]?.status === 'rendering') t[tk] = { ...t[tk], status: 'queued' } }
          useReviewStore.setState({ thumbs: t })
          if (!queue.includes(itemId)) queue.push(itemId)
        }
      } catch (e) {
        if (e instanceof CancelledError) break
        mark('error', { error: e instanceof Error ? e.message : String(e) })
      }
      const s = useReviewStore.getState()
      const all = Object.values(s.thumbs)
      useReviewStore.setState({ progress: { done: all.filter((t) => t.status === 'ready').length, total: all.filter((t) => t.status !== 'waiting' && t.status !== 'failed').length, running: queue.length > 0 } })
    }
  } finally {
    pumping = false
    const s = useReviewStore.getState()
    useReviewStore.setState({ progress: { ...s.progress, running: queue.length > 0 } })
    if (queue.length && ctxRef) void pump()
  }
}

function onThumb(ctx: ReviewContext, itemId: string, t: ThumbResult, expectedHash: string | null): void {
  const tk = thumbKey(itemId, t.key)
  const cur = useReviewStore.getState().thumbs[tk]
  if (!cur || !cur.hash) return
  if (expectedHash && cur.hash !== expectedHash) return   // 描画中に設定が変わった → 捨てて描き直す
  const url = URL.createObjectURL(t.blob)
  setThumbUrl(tk, url)
  useReviewStore.setState({ thumbs: { ...useReviewStore.getState().thumbs, [tk]: { ...cur, status: 'ready', url, warnings: t.warnings, transparent: t.transparent, scale: t.scale } } })
  const hash = cur.hash
  const path = `${ctx.teamId}/${ctx.jobId}/${itemId}/${thumbFileName(t.key, hash, t.transparent)}`
  enqueuePersist(async () => {
    try {
      await uploadBatchObject(path, t.blob, t.transparent ? 'image/png' : 'image/jpeg')
    } catch (e) {
      if (!/already exists|duplicate|409/i.test(e instanceof Error ? e.message : String(e))) throw e
    }
    await recordThumb(itemId, t.key, hash, path)
  })
}
