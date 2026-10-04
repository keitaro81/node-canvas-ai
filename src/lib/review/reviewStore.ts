// ReviewGrid の状態（仕様 5 章 / 4-9 / 4-10）。
// - サムネイルは識別値（layoutHash）で管理: 記録済みなら Storage から、無ければ実行者（Worker）で描いて保存・記録する
// - 同時に描くのは 1 アイテムだけ。画面側は長辺 400px のサムネイル（object URL）しか持たない
// - 列 = 切り抜き・バリアント（レイアウト）・生成結果（写真ごとの Image Generation ノードごと。フェーズ C(a)）
// - 状態は createReviewStore() で画面ごとに作る: ジョブ管理画面は既定の 1 つ（useReviewStore）、一括結果ノードはノードごとに 1 つ（フェーズ C(b)）
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { CutoutParams } from '../../types/nodes'
import type { BatchItemRow, BatchOutputRow, BatchTaskRow } from '../../types/batch'
import { layoutHash, layoutIdentityString, sha256Hex, type LayoutIdentityInput } from '../layout/identity'
import { signBatchPath, signBatchPaths, uploadBatchObjectIfMissing } from '../cutout/store'
import { fetchBlob } from '../cutout/decode'
import { recordThumb } from '../api/batchJobs'
import { CancelledError, createLayoutExecutor, type LayoutExecutor } from './executor'
import {
  CUTOUT_PREVIEW_PARAMS, CUTOUT_VARIANT_KEY, THUMB_MAX_EDGE, chainedSourceRef, cutoutParamsOf, identityFor, isResultKey, resultIdentityString, resultKindOf, resultNodeIdOf,
  taskDependencyOf, thumbFileName, thumbKey, type ReviewFilter, type ReviewResultColumn, type ReviewVariant,
} from './model'
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
  results: ReviewResultColumn[]           // 生成結果の列（写真ごとの Image Generation ノード）
  cutoutNodeId: string | null
  cutoutParams: CutoutParams            // 写しの切り抜き設定（タスクに __params があればそちら）
  knownThumbs: BatchOutputRow[]
  backgroundUrls: Record<string, string> // 背景画像ノード ID → 署名 URL（Step 8）
}

export interface ItemRenderable {
  item: BatchItemRow
  task: BatchTaskRow
  cutout: CutoutParams
  sourcePath: string                     // 切り抜きの元画像（写真、または前段の生成結果）
  sourceRef: string                      // 識別値に使う元画像の参照（前段の結果なら パス#版）
}

export interface ReviewState {
  jobId: string | null
  bg: ReviewBg
  filter: ReviewFilter
  focusId: string | null                 // キーボード操作の現在位置（アイテム id）
  activeKey: string                      // 表示中の列（切り抜き・バリアント・生成結果）
  selected: Set<string>                  // チェックした写真（アイテム id）
  lightbox: { itemId: string; variantKey: string } | null
  thumbs: Record<string, ThumbState>
  progress: { done: number; total: number; running: boolean }
  executorKind: 'worker' | 'main' | null
  open: (jobId: string) => void
  close: () => void
  setBg: (bg: ReviewBg) => void
  setFilter: (f: ReviewFilter) => void
  setFocusId: (id: string | null) => void
  setActiveKey: (key: string) => void
  toggleSelected: (id: string) => void
  setSelected: (ids: Iterable<string>) => void
  clearSelected: () => void
  setLightbox: (l: { itemId: string; variantKey: string } | null) => void
  sync: (ctx: ReviewContext) => Promise<void>
  renderFull: (itemId: string, variantKey: string) => Promise<FullResult>
  getExecutor: () => LayoutExecutor
}

export type ReviewStoreApi = StoreApi<ReviewState>
/** セレクタで読める hook と、getState/setState/subscribe を併せ持つ（zustand の create() が返すものと同じ形） */
export type ReviewStoreHook = (<T>(selector: (s: ReviewState) => T) => T) & ReviewStoreApi

// ── インスタンス間で共有してよいもの（純粋な計算結果と、保存のスロットル・重複排除） ──
const hashCache = new Map<string, string>()    // identityString → hash
let persistInFlight = 0
const persistQueue: Array<() => Promise<void>> = []
const persistedPaths = new Set<string>()                   // このタブで保存済みのサムネイルのパス（別のインスタンスが同じものを上げない）
const inFlightPaths = new Map<string, Promise<void>>()     // 保存中のパス（同時に走った別インスタンスは待つだけ）

/** サムネイルを保存して記録する。同じパスはタブ内で 1 回だけ（ジョブ管理 / 一括結果ノード / App の結果欄が同じジョブを描いても重複しない） */
async function persistThumbOnce(path: string, blob: Blob, contentType: string, record: () => Promise<void>): Promise<void> {
  if (persistedPaths.has(path)) return
  const running = inFlightPaths.get(path)
  if (running) { await running; return }
  const p = (async () => {
    await uploadBatchObjectIfMissing(path, blob, contentType)
    await record()
    persistedPaths.add(path)
  })()
  inFlightPaths.set(path, p)
  try { await p } finally { inFlightPaths.delete(path) }
}

async function hashOf(input: LayoutIdentityInput): Promise<string> {
  const id = layoutIdentityString(input)
  const cached = hashCache.get(id)
  if (cached) return cached
  const h = await layoutHash(input)
  hashCache.set(id, h)
  return h
}

async function hashOfString(id: string): Promise<string> {
  const cached = hashCache.get(id)
  if (cached) return cached
  const h = await sha256Hex(id)
  hashCache.set(id, h)
  return h
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

const isDone = (t: BatchTaskRow | null | undefined): t is DoneTask => !!t && t.status === 'completed' && !!t.result_path
/** 完了して結果ファイルがあるタスク */
export type DoneTask = BatchTaskRow & { result_path: string }

/** アイテムの切り抜きが描画可能か（切り抜きタスク完了・結果ファイルあり。前段があればその結果が元画像） */
export function renderableOf(ctx: ReviewContext, item: BatchItemRow): ItemRenderable | null {
  if (!ctx.cutoutNodeId) return null
  const task = ctx.tasks.find((t) => t.item_id === item.id && t.node_id === ctx.cutoutNodeId)
  if (!isDone(task)) return null
  const depId = taskDependencyOf(task)
  const dep = depId ? ctx.tasks.find((t) => t.item_id === item.id && t.node_id === depId) ?? null : null
  if (depId && !isDone(dep)) return null
  const sourcePath = dep?.result_path ?? item.source_path ?? item.interactive_path ?? null
  if (!sourcePath) return null
  return { item, task, cutout: cutoutParamsOf(task, ctx.cutoutParams), sourcePath, sourceRef: dep ? chainedSourceRef(dep) : sourcePath }
}

/** 生成結果の列のタスク（アイテム × ノード） */
export function resultTaskOf(ctx: ReviewContext, itemId: string, nodeId: string): BatchTaskRow | null {
  return ctx.tasks.find((t) => t.item_id === itemId && t.node_id === nodeId) ?? null
}

/** 完了した生成結果（結果ファイルあり）だけを返す */
export function completedResultOf(ctx: ReviewContext, itemId: string, nodeId: string): DoneTask | null {
  const t = resultTaskOf(ctx, itemId, nodeId)
  return isDone(t) ? t : null
}

/** レイアウト系の列（切り抜き + バリアント）。切り抜きノードが無いジョブには無い */
function layoutKeys(ctx: ReviewContext): string[] {
  return ctx.cutoutNodeId ? [CUTOUT_VARIANT_KEY, ...ctx.variants.map((v) => v.key)] : []
}

function identityOf(ctx: ReviewContext, r: ItemRenderable, key: string): LayoutIdentityInput {
  const v = ctx.variants.find((x) => x.key === key)
  const params = key === CUTOUT_VARIANT_KEY || !v ? CUTOUT_PREVIEW_PARAMS : v.params
  const backgroundRef = v?.backgroundNodeId ? (ctx.backgroundUrls[v.backgroundNodeId] ? `node:${v.backgroundNodeId}` : null) : null
  return identityFor({ item: r.item, task: r.task, cutout: r.cutout, params, backgroundRef, sourceRef: r.sourceRef })
}

/** 描けないタイルの表示状態（失敗 or 待機） */
function idleState(failed: boolean, transparent: boolean, error?: string): ThumbState {
  return { status: failed ? 'failed' : 'waiting', url: null, hash: null, warnings: [], transparent, scale: null, error: failed ? (error ?? '処理に失敗しました') : undefined }
}

/** 元画像（写真か前段の結果）と切り抜き結果の署名 URL（実行者に渡す。Worker は署名 URL だけを受け取る） */
export async function assetsFor(r: ItemRenderable) {
  if (!r.task.result_path) throw new Error('元画像または結果ファイルがありません')
  const map = await signBatchPaths([r.sourcePath, r.task.result_path])
  const originalUrl = map[r.sourcePath], resultUrl = map[r.task.result_path]
  if (!originalUrl || !resultUrl) throw new Error('画像の署名に失敗しました（チームの権限を確認してください）')
  return { originalUrl, resultUrl, resultKind: resultKindOf(r.task) }
}

/** 確認グリッドの状態を 1 つ作る。close() で描画を止め、Worker と object URL を解放する */
export function createReviewStore(): ReviewStoreApi {
  // ── このインスタンスの作業状態（React の再描画に関係ないもの） ──
  let executor: LayoutExecutor | null = null
  let ctxRef: ReviewContext | null = null
  let queue: string[] = []                       // 描画待ちのアイテム ID（表示順）
  let pumping = false
  let syncGen = 0
  const objectUrls = new Map<string, string>()   // thumbKey → object URL（差し替え時に revoke）
  const persisted = new Map<string, string>()    // このインスタンスで保存した記録 `${item}|${variant}|${hash}` → path（知っている記録が取り直されるまでの間に描き直さない）

  const getExecutorImpl = (): LayoutExecutor => {
    if (!executor) executor = createLayoutExecutor()
    return executor
  }
  const setThumbUrl = (key: string, url: string | null): void => {
    const prev = objectUrls.get(key)
    if (prev && prev !== url) { URL.revokeObjectURL(prev); objectUrls.delete(key) }
    if (url && url.startsWith('blob:')) objectUrls.set(key, url)
  }

  const store = createStore<ReviewState>((set, get) => ({
    jobId: null,
    bg: 'checker',
    filter: 'all',
    focusId: null,
    activeKey: CUTOUT_VARIANT_KEY,
    selected: new Set<string>(),
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
      executor?.dispose()
      executor = null
      for (const u of objectUrls.values()) URL.revokeObjectURL(u)
      objectUrls.clear()
      set({ jobId: null, thumbs: {}, focusId: null, activeKey: CUTOUT_VARIANT_KEY, selected: new Set<string>(), lightbox: null, progress: { done: 0, total: 0, running: false } })
    },

    setBg: (bg) => set({ bg }),
    setFilter: (filter) => set({ filter, focusId: null }),
    setFocusId: (focusId) => set({ focusId }),
    setActiveKey: (activeKey) => set({ activeKey }),
    toggleSelected: (id) => set((st) => { const next = new Set(st.selected); if (next.has(id)) next.delete(id); else next.add(id); return { selected: next } }),
    setSelected: (ids) => set({ selected: new Set(ids) }),
    clearSelected: () => set({ selected: new Set<string>() }),
    setLightbox: (lightbox) => set({ lightbox }),
    getExecutor: () => getExecutorImpl(),

    /**
     * 文脈（アイテム・タスク・バリアント・結果列・記録済みサムネイル）を受け取り、各タイルの望ましい識別値を出して
     * 「記録済みなら署名して表示」「無ければ描画待ちに積む」を決める。差分だけを更新する。
     */
    sync: async (ctx) => {
      ctxRef = ctx
      const gen = ++syncGen
      const lkeys = layoutKeys(ctx)
      const next: Record<string, ThumbState> = { ...get().thumbs }
      const toSign: Array<{ key: string; path: string; hash: string; transparent: boolean }> = []
      const needRender = new Set<string>()
      const known = new Map<string, { output_path: string }>()
      for (const o of ctx.knownThumbs) known.set(`${o.item_id}|${o.variant}|${o.layout_hash}`, o)
      for (const [k, path] of persisted) if (!known.has(k)) known.set(k, { output_path: path })
      const keep = (cur: ThumbState | undefined, hash: string) => !!cur && cur.hash === hash && (cur.status === 'ready' || cur.status === 'rendering' || cur.status === 'queued')
      const place = (tk: string, itemId: string, hash: string, transparent: boolean, cur: ThumbState | undefined, key: string) => {
        const rec = known.get(`${itemId}|${key}|${hash}`)
        if (rec) {
          toSign.push({ key: tk, path: rec.output_path, hash, transparent })
          next[tk] = { status: 'queued', url: cur?.url ?? null, hash, warnings: cur?.warnings ?? [], transparent, scale: cur?.scale ?? null }
        } else {
          next[tk] = { status: 'queued', url: cur?.url ?? null, hash, warnings: [], transparent, scale: null }
          needRender.add(itemId)
        }
      }

      for (const item of ctx.items) {
        const r = renderableOf(ctx, item)
        // レイアウト系（切り抜き + バリアント）
        for (const key of lkeys) {
          const tk = thumbKey(item.id, key)
          const cur = next[tk]
          if (!r) {
            const failed = item.status === 'failed'
            if (cur?.status !== (failed ? 'failed' : 'waiting')) {
              setThumbUrl(tk, null)
              next[tk] = idleState(failed, key === CUTOUT_VARIANT_KEY, item.warnings[0])
            }
            continue
          }
          const hash = await hashOf(identityOf(ctx, r, key))
          if (gen !== syncGen) return
          if (keep(cur, hash)) continue
          const v = ctx.variants.find((x) => x.key === key)
          place(tk, item.id, hash, key === CUTOUT_VARIANT_KEY || v?.params.backgroundKind === 'transparent', cur, key)
        }
        // 生成結果（ノードごと）: タスクが完了していれば結果ファイルのサムネイル
        for (const col of ctx.results) {
          const tk = thumbKey(item.id, col.key)
          const cur = next[tk]
          const task = resultTaskOf(ctx, item.id, col.nodeId)
          if (!isDone(task)) {
            const failed = task?.status === 'failed' || (!task && item.status === 'failed')
            if (cur?.status !== (failed ? 'failed' : 'waiting')) {
              setThumbUrl(tk, null)
              next[tk] = idleState(failed, false, task?.error ?? item.warnings[0])
            }
            continue
          }
          const hash = await hashOfString(resultIdentityString(task))
          if (gen !== syncGen) return
          if (keep(cur, hash)) continue
          place(tk, item.id, hash, cur?.transparent ?? false, cur, col.key)
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
      // 生成結果の列: 結果ファイルをそのまま返す
      if (isResultKey(variantKey)) {
        const task = completedResultOf(ctx, itemId, resultNodeIdOf(variantKey))
        if (!task) throw new Error('この生成結果はまだありません')
        const url = await signBatchPath(task.result_path)
        if (!url) throw new Error('結果画像の署名に失敗しました（チームの権限を確認してください）')
        const blob = await fetchBlob(url)
        return { key: variantKey, blob, warnings: [], quality: null, format: blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpeg' }
      }
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
        if (!item) continue
        const r = renderableOf(ctx, item)
        const st = store.getState()
        const queuedOf = (ks: string[]) => ks.filter((k) => st.thumbs[thumbKey(itemId, k)]?.status === 'queued')
        const lkeys = r ? queuedOf(layoutKeys(ctx)) : []
        const rkeys = queuedOf(ctx.results.map((c) => c.key))
        const keys = [...lkeys, ...rkeys]
        if (!keys.length) continue
        const mark = (status: ThumbStatus, patch: Partial<ThumbState> = {}) => {
          const cur = store.getState().thumbs
          const t = { ...cur }
          for (const k of keys) { const tk = thumbKey(itemId, k); if (t[tk]) t[tk] = { ...t[tk], status, ...patch } }
          store.setState({ thumbs: t })
        }
        const expected: Record<string, string | null> = {}
        for (const k of keys) expected[k] = st.thumbs[thumbKey(itemId, k)]?.hash ?? null
        mark('rendering')
        try {
          if (r && lkeys.length) {
            const assets = await assetsFor(r)
            const variants = ctx.variants
              .filter((v) => lkeys.includes(v.key))
              .map((v) => ({ key: v.key, params: v.params, backgroundUrl: v.backgroundNodeId ? ctx.backgroundUrls[v.backgroundNodeId] ?? null : null }))
            await getExecutorImpl().renderThumbs(
              { assets, cutout: r.cutout, variants, thumbMaxEdge: THUMB_MAX_EDGE, includeCutout: lkeys.includes(CUTOUT_VARIANT_KEY) },
              (t: ThumbResult) => onThumb(ctx, itemId, t, expected[t.key] ?? null),
            )
          }
          for (const k of rkeys) {
            const task = completedResultOf(ctx, itemId, resultNodeIdOf(k))
            if (!task) continue
            const url = await signBatchPath(task.result_path)
            if (!url) throw new Error('結果画像の署名に失敗しました')
            await getExecutorImpl().renderImageThumb({ key: k, url, thumbMaxEdge: THUMB_MAX_EDGE }, (t: ThumbResult) => onThumb(ctx, itemId, t, expected[k] ?? null))
          }
          // 描画中に識別値が変わったタイルは queued のまま残るので、同じアイテムをもう一度並べる
          const after = store.getState().thumbs
          if (keys.some((k) => after[thumbKey(itemId, k)]?.status === 'rendering')) {
            const t = { ...after }
            for (const k of keys) { const tk = thumbKey(itemId, k); if (t[tk]?.status === 'rendering') t[tk] = { ...t[tk], status: 'queued' } }
            store.setState({ thumbs: t })
            if (!queue.includes(itemId)) queue.push(itemId)
          }
        } catch (e) {
          if (e instanceof CancelledError) break
          mark('error', { error: e instanceof Error ? e.message : String(e) })
        }
        const s = store.getState()
        const all = Object.values(s.thumbs)
        store.setState({ progress: { done: all.filter((t) => t.status === 'ready').length, total: all.filter((t) => t.status !== 'waiting' && t.status !== 'failed').length, running: queue.length > 0 } })
      }
    } finally {
      pumping = false
      const s = store.getState()
      store.setState({ progress: { ...s.progress, running: queue.length > 0 } })
      if (queue.length && ctxRef) void pump()
    }
  }

  function onThumb(ctx: ReviewContext, itemId: string, t: ThumbResult, expectedHash: string | null): void {
    const tk = thumbKey(itemId, t.key)
    const cur = store.getState().thumbs[tk]
    if (!cur || !cur.hash) return
    if (expectedHash && cur.hash !== expectedHash) return   // 描画中に設定が変わった → 捨てて描き直す
    const url = URL.createObjectURL(t.blob)
    setThumbUrl(tk, url)
    store.setState({ thumbs: { ...store.getState().thumbs, [tk]: { ...cur, status: 'ready', url, warnings: t.warnings, transparent: t.transparent, scale: t.scale } } })
    const hash = cur.hash
    const path = `${ctx.teamId}/${ctx.jobId}/${itemId}/${thumbFileName(t.key, hash, t.transparent)}`
    enqueuePersist(async () => {
      await persistThumbOnce(path, t.blob, t.transparent ? 'image/png' : 'image/jpeg', () => recordThumb(itemId, t.key, hash, path))
      persisted.set(`${itemId}|${t.key}|${hash}`, path)
    })
  }

  return store
}

/** セレクタで読める hook を付けた形で作る（コンポーネント内では useMemo で 1 回だけ作ること） */
export function createReviewStoreHook(): ReviewStoreHook {
  const api = createReviewStore()
  const hook = (<T,>(selector: (s: ReviewState) => T): T => useStore(api, selector)) as ReviewStoreHook
  return Object.assign(hook, api)
}

/** ジョブ管理画面が使う既定のインスタンス */
export const useReviewStore: ReviewStoreHook = createReviewStoreHook()
