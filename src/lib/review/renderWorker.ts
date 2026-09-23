// ReviewGrid の描画ワーカー（module worker）。メインスレッドはフル解像度の画素に触れない（仕様 4-9）。
// メッセージ: thumbs（1 アイテムの全バリアントのサムネイル）/ full（フル解像度・任意で形式変換）/ cancel
import { loadItemAssets, renderItemFull, renderItemThumbs, type CutoutSpec, type FullResult, type FullVariantSpec, type ItemAssetsInput, type ThumbResult, type VariantSpec } from './renderCore'

export type WorkerRequest =
  | { type: 'thumbs'; reqId: number; assets: ItemAssetsInput; cutout: CutoutSpec; variants: VariantSpec[]; thumbMaxEdge: number; includeCutout: boolean }
  | { type: 'full'; reqId: number; assets: ItemAssetsInput; cutout: CutoutSpec; variants: FullVariantSpec[] }
  | { type: 'cancel'; reqId: number }

export type WorkerResponse =
  | { type: 'thumb'; reqId: number; result: ThumbResult }
  | { type: 'full'; reqId: number; result: FullResult }
  | { type: 'done'; reqId: number }
  | { type: 'error'; reqId: number; message: string }

const cancelled = new Set<number>()
const scope = self as unknown as { postMessage: (m: WorkerResponse) => void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null }

scope.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'cancel') { cancelled.add(msg.reqId); return }
  const { reqId } = msg
  const isCancelled = () => cancelled.has(reqId)
  try {
    const assets = await loadItemAssets(msg.assets)
    if (msg.type === 'thumbs') {
      await renderItemThumbs(assets, msg.cutout, msg.variants, { thumbMaxEdge: msg.thumbMaxEdge, includeCutout: msg.includeCutout, isCancelled }, (result) => scope.postMessage({ type: 'thumb', reqId, result }))
    } else {
      await renderItemFull(assets, msg.cutout, msg.variants, (result) => scope.postMessage({ type: 'full', reqId, result }), isCancelled)
    }
    scope.postMessage({ type: 'done', reqId })
  } catch (err) {
    scope.postMessage({ type: 'error', reqId, message: err instanceof Error ? err.message : String(err) })
  } finally {
    cancelled.delete(reqId)
  }
}
