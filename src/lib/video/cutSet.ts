// Cut Set（SKU ごとの役割別カット）のカードの型と純関数。CutSetCards（App・ノード共用の UI）/ AppVideoCutsInput / CutSetInputNode が使う
import { CUT_ROLES, type CutRole } from './productVideo'
import type { CreateItemInput } from '../api/batch'
import type { CutSetItem } from '../../types/nodes'

export const CUT_SET_ACCENT = '#EC4899'
export const MAX_SKUS = 50

export interface CutSlot { role: CutRole; file?: File; path?: string | null; width?: number; height?: number; name?: string; status: 'empty' | 'uploading' | 'ready' | 'error'; error?: string }
export interface SkuCard { id: string; sku: string; cuts: Record<CutRole, CutSlot> }
export type CardsUpdater = SkuCard[] | ((prev: SkuCard[]) => SkuCard[])

export const emptyCuts = (): Record<CutRole, CutSlot> => Object.fromEntries(CUT_ROLES.map((r) => [r.id, { role: r.id, status: 'empty' }])) as Record<CutRole, CutSlot>
export const newCard = (n: number): SkuCard => ({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sku: `SKU-${String(n).padStart(3, '0')}`, cuts: emptyCuts() })

/** 投入できる SKU（正面があり SKU 名がある）→ ジョブ作成の入力（1 件 = 1 SKU・正面を元画像に） */
export function cardsToItems(cards: SkuCard[]): CreateItemInput[] {
  return cards
    .filter((c) => c.cuts.front.status === 'ready' && !!c.cuts.front.path && c.sku.trim() !== '')
    .map((c, i) => {
      const cuts = CUT_ROLES.map((r) => c.cuts[r.id]).filter((s) => s.status === 'ready' && s.path).map((s) => ({ role: s.role, path: s.path as string, width: s.width, height: s.height, name: s.name }))
      const front = c.cuts.front
      return { index: i + 1, originalName: front.name ?? `${c.sku}.jpg`, sku: c.sku.trim(), interactivePath: front.path as string, width: front.width, height: front.height, cuts }
    })
}
/** ノードの保存形（ready なカットだけ）→ カード */
export function cardsFromItems(items: CutSetItem[] | null | undefined): SkuCard[] {
  return (Array.isArray(items) ? items : []).map((it) => {
    const cuts = emptyCuts()
    for (const r of CUT_ROLES) { const c = it.cuts?.[r.id]; if (c?.path) cuts[r.id] = { role: r.id, path: c.path, width: c.width, height: c.height, name: c.name, status: 'ready' } }
    return { id: it.id, sku: it.sku, cuts }
  })
}
/** カード → ノードの保存形（ready なカットだけ・並び順を振り直す） */
export function itemsFromCards(cards: SkuCard[]): CutSetItem[] {
  return cards.map((c, i) => {
    const cuts: CutSetItem['cuts'] = {}
    for (const r of CUT_ROLES) { const s = c.cuts[r.id]; if (s.status === 'ready' && s.path) cuts[r.id] = { path: s.path, width: s.width, height: s.height, name: s.name } }
    return { id: c.id, index: i + 1, sku: c.sku, cuts }
  })
}

