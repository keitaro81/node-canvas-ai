// レイアウトの実行者（仕様 4-10 の 4「実行者を差し替えられる構造」）。
// 今回はブラウザ実行のみ: Worker 実装（既定）と、OffscreenCanvas が無い環境向けのメインスレッド実装。
// 将来のサーバー実行は、この LayoutExecutor を実装してサーバーが書いた出力を返すだけでよい。
import type { WorkerRequest, WorkerResponse } from './renderWorker'
import { loadItemAssets, renderItemFull, renderItemThumbs, type CutoutSpec, type FullResult, type FullVariantSpec, type ItemAssetsInput, type ThumbResult, type VariantSpec } from './renderCore'

export interface ThumbsRequest { assets: ItemAssetsInput; cutout: CutoutSpec; variants: VariantSpec[]; thumbMaxEdge: number; includeCutout: boolean }
export interface FullRequest { assets: ItemAssetsInput; cutout: CutoutSpec; variants: FullVariantSpec[] }

export interface LayoutExecutor {
  readonly kind: 'worker' | 'main'
  /** 1 アイテムの全バリアントのサムネイル。できた順に onThumb。1 件ずつ直列に処理する（メモリ上限） */
  renderThumbs(req: ThumbsRequest, onThumb: (t: ThumbResult) => void): Promise<void>
  /** フル解像度（拡大表示・書き出し）。できた順に onResult */
  renderFull(req: FullRequest, onResult: (r: FullResult) => void): Promise<void>
  /** 進行中を打ち切る（待ち行列も空にする） */
  cancelAll(): void
  dispose(): void
}

export class CancelledError extends Error { constructor() { super('cancelled'); this.name = 'CancelledError' } }

/** 直列化: 同時に 1 リクエストだけ処理する */
class Serial {
  private tail: Promise<void> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn)
    this.tail = p.then(() => undefined, () => undefined)
    return p
  }
}

type Pending = { onItem: (r: ThumbResult | FullResult) => void; resolve: () => void; reject: (e: Error) => void }

class WorkerLayoutExecutor implements LayoutExecutor {
  readonly kind = 'worker' as const
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private serial = new Serial()
  private generation = 0

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data
      const p = this.pending.get(m.reqId)
      if (!p) return
      if (m.type === 'thumb' || m.type === 'full') p.onItem(m.result)
      else if (m.type === 'done') { this.pending.delete(m.reqId); p.resolve() }
      else if (m.type === 'error') { this.pending.delete(m.reqId); p.reject(new Error(m.message)) }
    }
    w.onerror = (ev) => {
      const err = new Error(ev.message || 'ワーカーでエラーが発生しました')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      w.terminate()
      this.worker = null
    }
    this.worker = w
    return w
  }

  private send(msg: Omit<WorkerRequest, 'reqId'> & { type: 'thumbs' | 'full' }, onItem: Pending['onItem']): Promise<void> {
    const gen = this.generation
    return this.serial.run(() => new Promise<void>((resolve, reject) => {
      if (gen !== this.generation) { reject(new CancelledError()); return }
      const reqId = ++this.seq
      this.pending.set(reqId, { onItem, resolve, reject })
      this.ensure().postMessage({ ...msg, reqId } as WorkerRequest)
    }))
  }

  renderThumbs(req: ThumbsRequest, onThumb: (t: ThumbResult) => void): Promise<void> {
    return this.send({ type: 'thumbs', ...req }, (r) => onThumb(r as ThumbResult))
  }
  renderFull(req: FullRequest, onResult: (r: FullResult) => void): Promise<void> {
    return this.send({ type: 'full', ...req }, (r) => onResult(r as FullResult))
  }
  cancelAll(): void {
    this.generation++
    const err = new CancelledError()
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
  }
  dispose(): void { this.cancelAll() }
}

class MainThreadLayoutExecutor implements LayoutExecutor {
  readonly kind = 'main' as const
  private serial = new Serial()
  private generation = 0
  renderThumbs(req: ThumbsRequest, onThumb: (t: ThumbResult) => void): Promise<void> {
    const gen = this.generation
    return this.serial.run(async () => {
      if (gen !== this.generation) throw new CancelledError()
      const assets = await loadItemAssets(req.assets)
      await renderItemThumbs(assets, req.cutout, req.variants, { thumbMaxEdge: req.thumbMaxEdge, includeCutout: req.includeCutout, isCancelled: () => gen !== this.generation }, onThumb)
    })
  }
  renderFull(req: FullRequest, onResult: (r: FullResult) => void): Promise<void> {
    const gen = this.generation
    return this.serial.run(async () => {
      if (gen !== this.generation) throw new CancelledError()
      const assets = await loadItemAssets(req.assets)
      await renderItemFull(assets, req.cutout, req.variants, onResult, () => gen !== this.generation)
    })
  }
  cancelAll(): void { this.generation++ }
  dispose(): void { this.cancelAll() }
}

export function createLayoutExecutor(): LayoutExecutor {
  const canWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
  if (canWorker) {
    try { return new WorkerLayoutExecutor() } catch { /* 下へ */ }
  }
  return new MainThreadLayoutExecutor()
}
