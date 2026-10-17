// 商品動画 App の「カットを入れる」欄（2026-10-13）: SKU ごとのカードに、役割（正面 / 右側面 / 左側面 / 背面 / ディテール / 全身）の枠を並べ、
// 写真をドロップ / クリックで入れる。ファイル名からは判定しない（ユーザー決定）。写真はこの画面だけで持ち、投入した処理には残る。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CircleNotch, Plus, Trash, X } from '@phosphor-icons/react'
import { CutRoleIcon } from './CutRoleIcon'
import { readImageSize } from '../../lib/batch/upload'
import { interactiveCutoutDir, resolveTeamId, signBatchPaths, uploadBatchObject } from '../../lib/cutout/store'
import { CUT_ROLES, CUT_ROLE_LABEL, FRONTAL_ROLE, shotRoleLabel, shotsAvailableFor, type CutRole, type VideoShotSpec } from '../../lib/video/productVideo'
import type { CreateItemInput } from '../../lib/api/batch'
import { showToast } from '../../hooks/useToast'

const ACCENT = '#EC4899'
const MAX_SKUS = 50

interface CutSlot { role: CutRole; file?: File; path?: string | null; width?: number; height?: number; name?: string; status: 'empty' | 'uploading' | 'ready' | 'error'; error?: string }
interface SkuCard { id: string; sku: string; cuts: Record<CutRole, CutSlot> }

interface Props {
  nodeId: string                  // Product Video ノード id（アップロード先の階層に使う）
  shots: VideoShotSpec[]          // ノードのショット構成（使う役割の枠を出す）
  canSubmit: boolean
  onSubmit: (items: CreateItemInput[]) => void
}

const emptyCuts = (): Record<CutRole, CutSlot> => Object.fromEntries(CUT_ROLES.map((r) => [r.id, { role: r.id, status: 'empty' }])) as Record<CutRole, CutSlot>
const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-80)
const newCard = (n: number): SkuCard => ({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sku: `SKU-${String(n).padStart(3, '0')}`, cuts: emptyCuts() })

export function AppVideoCutsInput({ nodeId, shots, canSubmit, onSubmit }: Props) {
  const [cards, setCards] = useState<SkuCard[]>(() => [newCard(1)])   // 最初から 1 件のカードを出す
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const fileInput = useRef<HTMLInputElement | null>(null)
  const pending = useRef<{ cardId: string; role: CutRole } | null>(null)
  // 構成で使う役割を「ショットの流れ」の順（始点 → 終点の初出順）に。正面は必須なので構成に無くても先頭に。使わない役割は補足カット（参照用）として下に
  const usedRoles = useMemo(() => {
    const order: CutRole[] = []
    const push = (r: CutRole | null | undefined) => { if (r && !order.includes(r)) order.push(r) }
    for (const s of shots) { push(s.role); push(s.endRole) }
    if (!order.includes(FRONTAL_ROLE)) order.unshift(FRONTAL_ROLE)
    return order.map((id) => CUT_ROLES.find((r) => r.id === id)!)
  }, [shots])
  const otherRoles = useMemo(() => CUT_ROLES.filter((r) => !usedRoles.some((u) => u.id === r.id)), [usedRoles])

  const patchSlot = useCallback((cardId: string, role: CutRole, patch: Partial<CutSlot>) => {
    setCards((list) => list.map((c) => (c.id === cardId ? { ...c, cuts: { ...c.cuts, [role]: { ...c.cuts[role], ...patch } } } : c)))
  }, [])

  const upload = useCallback(async (cardId: string, role: CutRole, file: File) => {
    patchSlot(cardId, role, { file, name: file.name, status: 'uploading', error: undefined, path: null })
    try {
      const teamId = await resolveTeamId()
      const size = await readImageSize(file)
      const path = `${interactiveCutoutDir(teamId, nodeId)}/items/app-${cardId}-${role}-${Date.now().toString(36)}-${safeName(file.name)}`
      await uploadBatchObject(path, file, file.type || 'image/jpeg')
      patchSlot(cardId, role, { status: 'ready', path, width: size?.width, height: size?.height, file: undefined })
    } catch (e) {
      patchSlot(cardId, role, { status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }, [nodeId, patchSlot])

  const addCard = useCallback(() => {
    setCards((list) => {
      if (list.length >= MAX_SKUS) { showToast(`SKU は最大 ${MAX_SKUS} 件までです`, 'warning'); return list }
      return [...list, newCard(list.length + 1)]
    })
  }, [])

  const pick = (cardId: string, role: CutRole) => { pending.current = { cardId, role }; fileInput.current?.click() }
  const onFilePicked = (files: FileList | null) => {
    const f = files?.[0]; const p = pending.current; pending.current = null
    if (!f || !p) return
    if (!f.type.startsWith('image/')) { showToast('画像ファイルを選んでください', 'warning'); return }
    void upload(p.cardId, p.role, f)
  }
  const onDrop = (e: React.DragEvent, cardId: string, role: CutRole) => {
    e.preventDefault()
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
    if (f) void upload(cardId, role, f)
  }

  // サムネイル（署名 URL）
  const readyKey = cards.flatMap((c) => CUT_ROLES.map((r) => c.cuts[r.id].path).filter((p): p is string => !!p)).join('|')
  useEffect(() => {
    const paths = readyKey ? readyKey.split('|') : []
    if (!paths.length) return
    let alive = true
    signBatchPaths(paths).then((map) => { if (alive) setThumbs((t) => ({ ...t, ...map })) }).catch(() => {})
    return () => { alive = false }
  }, [readyKey])

  const uploading = cards.some((c) => CUT_ROLES.some((r) => c.cuts[r.id].status === 'uploading'))
  useEffect(() => {
    if (!uploading) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [uploading])

  // 投入できる SKU: 正面があり、ショットが 1 つ以上組める
  const readyCards = cards.filter((c) => c.cuts.front.status === 'ready' && c.sku.trim() !== '')
  const submit = () => {
    const items: CreateItemInput[] = readyCards.map((c, i) => {
      const cuts = CUT_ROLES.map((r) => c.cuts[r.id]).filter((s) => s.status === 'ready' && s.path).map((s) => ({ role: s.role, path: s.path as string, width: s.width, height: s.height, name: s.name }))
      const front = c.cuts.front
      return { index: i + 1, originalName: front.name ?? `${c.sku}.jpg`, sku: c.sku.trim(), interactivePath: front.path as string, width: front.width, height: front.height, cuts }
    })
    if (items.length) onSubmit(items)
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => { onFilePicked(e.target.files); e.target.value = '' }} />
      {cards.map((card) => {
        const ready = (r: CutRole) => card.cuts[r].status === 'ready'
        const available = shotsAvailableFor(shots, CUT_ROLES.map((r) => card.cuts[r.id]).filter((s) => s.status === 'ready' && s.path).map((s) => ({ role: s.role, path: s.path as string })))
        const noShots = available.length === 0 && ready(FRONTAL_ROLE)   // 正面は入れたのに作れるショットが無い（空のカードでは出さない）
        const renderSlot = (roleDef: typeof CUT_ROLES[number], supplementary: boolean) => {
          const slot = card.cuts[roleDef.id]
          const required = roleDef.id === FRONTAL_ROLE
          const thumb = slot.path ? thumbs[slot.path] : null
          return (
            <div
              key={roleDef.id}
              className={`relative rounded-lg flex flex-col items-center justify-center text-center cursor-pointer select-none ${supplementary ? 'h-[72px]' : 'h-[96px]'}`}
              style={{ background: 'var(--bg-placeholder)', border: `1px ${slot.status === 'ready' ? 'solid' : 'dashed'} ${required && slot.status !== 'ready' ? ACCENT : 'var(--border-active)'}`, overflow: 'hidden' }}
              title={supplementary ? `${roleDef.label}（補足カット・参照用）: ${roleDef.hint}。動画の角度には使いません` : `${roleDef.label}: ${roleDef.hint}`}
              onClick={() => pick(card.id, roleDef.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, card.id, roleDef.id)}
            >
              {thumb && slot.status === 'ready' ? <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} /> : null}
              {slot.status === 'uploading' && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.6)' }}><CircleNotch size={16} className="animate-spin" /></div>}
              {slot.status !== 'ready' && slot.status !== 'uploading' && (
                <div className="flex flex-col items-center gap-0.5" style={{ color: slot.status === 'error' ? '#EF4444' : 'var(--text-secondary)' }}>
                  <CutRoleIcon role={roleDef.id} size={supplementary ? 18 : 24} />
                  <span className="text-[10px] font-medium">{roleDef.label}{required ? ' *' : ''}</span>
                  {slot.status === 'error' && <span className="text-[9px]">失敗</span>}
                </div>
              )}
              {supplementary && (
                <span className="absolute top-0.5 left-0.5 px-1 rounded text-[9px]" style={slot.status === 'ready' ? { background: 'rgba(0,0,0,0.55)', color: '#fff' } : { background: 'var(--bg-surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}>参照</span>
              )}
              {slot.status === 'ready' && (
                <>
                  <span className="absolute bottom-0.5 left-0.5 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>{roleDef.label}</span>
                  <button type="button" className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(0,0,0,0.55)' }} title="このカットを外す" onClick={(e) => { e.stopPropagation(); patchSlot(card.id, roleDef.id, { status: 'empty', path: null, name: undefined, width: undefined, height: undefined, file: undefined }) }}><X size={10} /></button>
                </>
              )}
            </div>
          )
        }
        return (
          <div key={card.id} className="rounded-lg p-2.5 flex flex-col gap-2" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <input
                value={card.sku}
                onChange={(e) => setCards((list) => list.map((c) => (c.id === card.id ? { ...c, sku: e.target.value } : c)))}
                className="flex-1 min-w-0 h-7 rounded px-2 text-[12px] font-medium focus:outline-none"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                placeholder="SKU（商品コード）"
                title="SKU。動画のファイル名になります"
              />
              <span className="text-[10px] tabular-nums shrink-0" style={{ color: noShots ? '#EF4444' : 'var(--text-tertiary)' }} title={noShots ? 'この構成で作れるショットがありません。必要なカット（終了カットを指定したショットは両方）を入れてください' : 'この SKU で作るショット数 / 構成のショット数'}>{available.length} / {shots.length} ショット</span>
              {cards.length > 1 && <button type="button" className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-elevated)]" style={{ color: 'var(--text-tertiary)' }} title="この SKU を外す" onClick={() => setCards((list) => list.filter((c) => c.id !== card.id))}><Trash size={12} /></button>}
            </div>
            {/* ショットの流れ: 番号付きで 始点 → 終点。カットが揃ったショットだけ色が付き、揃っていないショットは飛ばす（役割名を押すとそのカットを選べる） */}
            <div className="flex flex-wrap items-center gap-1">
              {shots.map((s, i) => {
                const ok = available.includes(i)
                const missing = [s.role, ...(s.endRole ? [s.endRole] : [])].filter((r) => !ready(r)).map((r) => CUT_ROLE_LABEL[r])
                const chip = (role: CutRole) => (
                  <button type="button" className="hover:underline" style={{ color: ready(role) ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: ready(role) ? 500 : 400 }} title={ready(role) ? `${CUT_ROLE_LABEL[role]}: 入っています` : `${CUT_ROLE_LABEL[role]}: 押して写真を選ぶ`} onClick={() => pick(card.id, role)}>{CUT_ROLE_LABEL[role]}</button>
                )
                return (
                  <span key={i} className="inline-flex items-center gap-1 h-5 pl-0.5 pr-1.5 rounded-full text-[10px]" style={{ background: 'var(--bg-surface)', border: `1px solid ${ok ? 'var(--border-active)' : 'var(--border)'}` }} title={ok ? `ショット ${i + 1}: ${shotRoleLabel(s)}・${s.duration} 秒` : `ショット ${i + 1}（${shotRoleLabel(s)}）は飛ばします: ${missing.join('・')} のカットがありません`}>
                    <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] tabular-nums" style={{ background: ok ? ACCENT : 'var(--border)', color: ok ? '#fff' : 'var(--text-tertiary)' }}>{i + 1}</span>
                    {chip(s.role)}
                    {s.endRole && (<><ArrowRight size={9} weight="bold" style={{ color: ok ? 'var(--text-secondary)' : 'var(--text-tertiary)' }} />{chip(s.endRole)}</>)}
                  </span>
                )
              })}
            </div>
            <div className="grid grid-cols-3 gap-1.5">{usedRoles.map((r) => renderSlot(r, false))}</div>
            {otherRoles.length > 0 && (
              <>
                <div className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                  <span className="text-[10px] font-medium shrink-0" style={{ color: 'var(--text-secondary)' }}>補足カット（任意）</span>
                  <span className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }} title="補足カットは動画の角度には使いません。同じ服の別角度として AI に渡し、見え方を揃えるためだけに使います">動画には出ません。服の見え方を揃える参照用</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 opacity-80">{otherRoles.map((r) => renderSlot(r, true))}</div>
              </>
            )}
          </div>
        )
      })}
      <button type="button" className="h-8 rounded-lg text-[12px] flex items-center justify-center gap-1 hover:bg-[var(--bg-elevated)]" style={{ border: '1px dashed var(--border-active)', color: 'var(--text-secondary)' }} onClick={addCard} disabled={cards.length >= MAX_SKUS}>
        <Plus size={12} />SKU を追加
      </button>
      <button
        className="h-9 w-full rounded-lg text-[12px] font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ background: ACCENT }}
        disabled={!canSubmit || readyCards.length === 0 || uploading}
        title={!canSubmit ? 'この App ではまだ処理を始められません（ワークフローが未保存です）' : uploading ? 'アップロードが終わるまで待ってください' : readyCards.length === 0 ? '正面のカットを入れてください' : `${readyCards.length} 件の SKU を処理します`}
        onClick={submit}
      >
        {readyCards.length} 件を処理する
      </button>
      <div className="text-[11px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
        正面（*）は必須です。同じ人物・同じ服のカットだけを入れてください。役割のカットが無いショットは飛ばして残りで 1 本にします。処理は裏側で進み、右の欄に結果が出ます。
      </div>
    </div>
  )
}
