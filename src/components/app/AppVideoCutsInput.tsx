// 商品動画 App の「カットを入れる」欄（2026-10-13）: SKU ごとのカードに役割の枠を並べる（本体は CutSetCards・Cut Set Input ノードと共用）。
// 入れた写真は処理の後も残し、このブラウザ（localStorage）に記憶して再読み込み後も復元する（2026-10-17 ユーザー要望）。
import { useEffect, useState } from 'react'
import { CUT_ROLES, type CutRole, type VideoShotSpec } from '../../lib/video/productVideo'
import type { CreateItemInput } from '../../lib/api/batch'
import { CutSetCards } from './CutSetCards'
import { CUT_SET_ACCENT, MAX_SKUS, cardsToItems, emptyCuts, newCard, type SkuCard } from '../../lib/video/cutSet'

interface Props {
  nodeId: string                  // Cut Set Input ノード id（アップロード先の階層に使う）
  shots: VideoShotSpec[]          // キャンバスの構成（使う役割の枠を出す）
  canSubmit: boolean
  onSubmit: (items: CreateItemInput[]) => void
  storageKey?: string | null      // カードの記憶キー（ワークフロー + ノード）。無ければ記憶しない
}

// ── ブラウザへの記憶（入れた写真のパスと SKU だけ。アップロード中・失敗は保存しない） ──
const STORAGE_PREFIX = 'nc:video-cuts:'
interface SavedCard { id: string; sku: string; cuts: Array<{ role: CutRole; path: string; width?: number; height?: number; name?: string }> }
const loadCards = (key: string | null | undefined): SkuCard[] | null => {
  if (!key) return null
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const data = JSON.parse(raw) as { v?: number; cards?: SavedCard[] }
    if (!Array.isArray(data.cards) || data.cards.length === 0) return null
    const known = new Set<string>(CUT_ROLES.map((r) => r.id))
    return data.cards.slice(0, MAX_SKUS).map((c) => {
      const cuts = emptyCuts()
      for (const s of c.cuts ?? []) if (s && known.has(s.role) && typeof s.path === 'string') cuts[s.role] = { role: s.role, path: s.path, width: s.width, height: s.height, name: s.name, status: 'ready' }
      return { id: String(c.id), sku: String(c.sku ?? ''), cuts }
    })
  } catch { return null }
}
const saveCards = (key: string | null | undefined, cards: SkuCard[]) => {
  if (!key) return
  try {
    const data = { v: 1, cards: cards.map((c) => ({ id: c.id, sku: c.sku, cuts: CUT_ROLES.map((r) => c.cuts[r.id]).filter((s) => s.status === 'ready' && s.path).map((s) => ({ role: s.role, path: s.path as string, width: s.width, height: s.height, name: s.name })) })) }
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data))
  } catch { /* 容量不足・プライベートモードなどは無視 */ }
}

export function AppVideoCutsInput({ nodeId, shots, canSubmit, onSubmit, storageKey }: Props) {
  const [cards, setCards] = useState<SkuCard[]>(() => loadCards(storageKey) ?? [newCard(1)])   // 記憶があれば復元、無ければ 1 件のカード
  useEffect(() => { saveCards(storageKey, cards) }, [cards, storageKey])
  const uploading = cards.some((c) => CUT_ROLES.some((r) => c.cuts[r.id].status === 'uploading'))
  const readyItems = cardsToItems(cards)

  return (
    <div className="flex flex-col gap-3">
      <CutSetCards nodeId={nodeId} shots={shots} cards={cards} onChange={setCards} />
      <button
        className="h-9 w-full rounded-lg text-[12px] font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ background: CUT_SET_ACCENT }}
        disabled={!canSubmit || readyItems.length === 0 || uploading}
        title={!canSubmit ? 'この App ではまだ処理を始められません（ワークフローが未保存です）' : uploading ? 'アップロードが終わるまで待ってください' : readyItems.length === 0 ? '正面のカットを入れてください' : `${readyItems.length} 件の SKU を処理します`}
        onClick={() => { if (readyItems.length) onSubmit(readyItems) }}
      >
        {readyItems.length} 件を処理する
      </button>
      <div className="text-[11px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
        正面（*）は必須です。同じ人物・同じ服のカットだけを入れてください。役割のカットが無いショットは飛ばして残りで 1 本にします。処理は裏側で進み、右の欄に結果が出ます。
      </div>
    </div>
  )
}
