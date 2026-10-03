// canvas_data を直接書き換える経路（生成結果の書込など）が進めた canvas_version を、ワークフローストアに知らせる。
// 保存の衝突確認（読み込んだ版のまま保存できるか）がずれて誤検知しないようにするため。api 層 → store の依存を作らない小さな橋渡し。
type Listener = (workflowId: string, version: number) => void
const listeners = new Set<Listener>()
export function onCanvasVersion(cb: Listener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
export function notifyCanvasVersion(workflowId: string, version: number): void {
  for (const l of listeners) l(workflowId, version)
}
