// Cut Set（SKU ごとの役割別カット）のカード群（2026-10-13 の App「カットを入れる」から切り出し・2026-10-31）。
// 商品動画 App の AppVideoCutsInput と Cut Set Input ノードで共用する。役割 = 正面 / 右側面 / 左側面 / 背面 / ディテール / 全身。
// 写真はドロップ / クリック（アップロード・ライブラリ・モデル）で入れ、ファイル名では判定しない（ユーザー決定）。
// shots（キャンバスの構成）から「始点 │ → │ 終点」の枠組みを出し、構成で使わない役割は「補足カット（参照用）」に並べる。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { libraryCanonicalUrl, pickedToFiles, touchLibraryItems } from '../../lib/api/library'
import { ModelPickerDialog } from '../library/ModelPickerDialog'
import { MediaPickerDialog } from '../library/MediaPickerDialog'
import { ArrowRight, CircleNotch, Plus, Star, Trash, X, UserCircle } from '@phosphor-icons/react'
import { CutRoleIcon } from './CutRoleIcon'
import { readImageSize } from '../../lib/batch/upload'
import { interactiveCutoutDir, resolveTeamId, signBatchPaths, uploadBatchObject } from '../../lib/cutout/store'
import { CUT_ROLES, CUT_ROLE_LABEL, FRONTAL_ROLE, shotRoleLabel, shotsAvailableFor, type CutRole, type VideoShotSpec } from '../../lib/video/productVideo'
import { CUT_SET_ACCENT, MAX_SKUS, newCard, type CardsUpdater, type CutSlot, type SkuCard } from '../../lib/video/cutSet'
import { showToast } from '../../hooks/useToast'

const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-80)

interface Props {
  nodeId: string                  // アップロード先の階層（interactive/<nodeId>/items/）
  shots: VideoShotSpec[]          // 構成（使う役割の枠を出す）
  cards: SkuCard[]
  onChange: (next: CardsUpdater) => void
  currentId?: string | null       // ★（対話実行で流す SKU。ノードだけ）
  onMakeCurrent?: (id: string) => void
  compact?: boolean               // ノード内（幅が狭い）
  disabled?: boolean
}

export function CutSetCards({ nodeId, shots, cards, onChange, currentId, onMakeCurrent, compact, disabled }: Props) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [picker, setPicker] = useState<{ cardId: string; role: CutRole } | null>(null)   // ライブラリから選ぶ対象の枠
  const [modelPickerFor, setModelPickerFor] = useState<string | null>(null)              // 「モデルから入れる」対象のカード
  // ショットで使う役割（始点・終点）。正面は必須なので、どのショットにも無ければ「主カット」の枠を別に出す。残りは補足カット（参照用）として下に
  const rolesInShots = useMemo(() => { const set = new Set<CutRole>(); for (const s of shots) { set.add(s.role); if (s.endRole) set.add(s.endRole) } return set }, [shots])
  const frontInShots = rolesInShots.has(FRONTAL_ROLE)
  const firstShotOfRole = useMemo(() => { const m = new Map<CutRole, number>(); shots.forEach((s, i) => { if (!m.has(s.role)) m.set(s.role, i); if (s.endRole && !m.has(s.endRole)) m.set(s.endRole, i) }); return m }, [shots])
  const otherRoles = useMemo(() => CUT_ROLES.filter((r) => !rolesInShots.has(r.id) && r.id !== FRONTAL_ROLE), [rolesInShots])

  const patchSlot = useCallback((cardId: string, role: CutRole, patch: Partial<CutSlot>) => {
    onChange((list) => list.map((c) => (c.id === cardId ? { ...c, cuts: { ...c.cuts, [role]: { ...c.cuts[role], ...patch } } } : c)))
  }, [onChange])

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
    onChange((list) => {
      if (list.length >= MAX_SKUS) { showToast(`SKU は最大 ${MAX_SKUS} 件までです`, 'warning'); return list }
      return [...list, newCard(list.length + 1)]
    })
  }, [onChange])

  const onDrop = (e: React.DragEvent, cardId: string, role: CutRole) => {
    e.preventDefault(); e.stopPropagation()
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
    if (f) void upload(cardId, role, f)
  }

  // サムネイル（署名 URL）
  const readyKey = cards.flatMap((c) => CUT_ROLES.map((r) => c.cuts[r.id].path).filter((p): p is string => !!p)).join('|')
  useEffect(() => {
    const paths = readyKey ? readyKey.split('|') : []
    if (!paths.length) return
    let alive = true
    signBatchPaths(paths).then((map) => {
      if (!alive) return
      setThumbs((t) => ({ ...t, ...map }))
      // 署名できなかったパス = ファイルが無い（記憶から復元したが消えていた等）→ その枠を「見つかりません」にして入れ直してもらう
      const missing = new Set(paths.filter((p) => !map[p]))
      if (missing.size) onChange((list) => list.map((c) => {
        let changed = false
        const cuts = { ...c.cuts }
        for (const r of CUT_ROLES) { const sl = cuts[r.id]; if (sl.status === 'ready' && sl.path && missing.has(sl.path)) { cuts[r.id] = { ...sl, status: 'error', error: '写真が見つかりません', path: null, file: undefined }; changed = true } }
        return changed ? { ...c, cuts } : c
      }))
    }).catch(() => {})
    return () => { alive = false }
  }, [readyKey, onChange])

  const uploading = cards.some((c) => CUT_ROLES.some((r) => c.cuts[r.id].status === 'uploading'))
  useEffect(() => {
    if (!uploading) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [uploading])

  const mainH = compact ? 'h-[72px]' : 'h-[92px]'
  const subH = compact ? 'h-[56px]' : 'h-[72px]'
  return (
    <div className="flex flex-col gap-3">
      <MediaPickerDialog open={!!picker} onClose={() => setPicker(null)} media="image" source="app-cuts" onPick={(picked) => {
        const target = picker; if (!target) return
        void pickedToFiles(picked.slice(0, 1)).then(([f]) => { if (f) void upload(target.cardId, target.role, f) }).catch((e) => showToast(e instanceof Error ? e.message : String(e), 'error'))
      }} />
      {cards.map((card) => {
        const ready = (r: CutRole) => card.cuts[r].status === 'ready'
        const anyReady = CUT_ROLES.some((r) => ready(r.id))
        const available = shotsAvailableFor(shots, CUT_ROLES.map((r) => card.cuts[r.id]).filter((s) => s.status === 'ready' && s.path).map((s) => ({ role: s.role, path: s.path as string })))
        const noShots = shots.length > 0 && available.length === 0 && ready(FRONTAL_ROLE)   // 正面は入れたのに作れるショットが無い（空のカードでは出さない）
        const isCurrent = !!onMakeCurrent && currentId === card.id
        // 1 枠 = 1 役割の写真。同じ役割が複数のショットに出るときは同じ写真を共有する（どの枠から入れても同じ）
        const renderSlot = (role: CutRole, tag: '始点' | '終点' | '参照' | '主カット', small = false, shotIndex?: number) => {
          const roleDef = CUT_ROLES.find((r) => r.id === role)!
          const slot = card.cuts[role]
          const required = role === FRONTAL_ROLE
          const supplementary = tag === '参照'
          const thumb = slot.path ? thumbs[slot.path] : null
          const isReady = slot.status === 'ready'
          const firstShot = shotIndex !== undefined ? firstShotOfRole.get(role) : undefined
          const sharedWith = firstShot !== undefined && firstShot < (shotIndex ?? 0) ? firstShot + 1 : null   // 前のショットと同じ写真を共有
          return (
            <div
              key={`${role}-${tag}`}
              className={`relative rounded-lg flex flex-col items-center justify-center text-center cursor-pointer select-none nodrag ${small ? subH : mainH}`}
              style={{ background: 'var(--bg-placeholder)', border: `1px ${isReady ? 'solid' : 'dashed'} ${required && !isReady ? CUT_SET_ACCENT : 'var(--border-active)'}`, overflow: 'hidden' }}
              title={`${supplementary ? `${roleDef.label}（補足カット・参照用）: ${roleDef.hint}。動画の角度には使いません` : `${tag}: ${roleDef.label}。${roleDef.hint}`}。クリックで追加（アップロード / ライブラリ）、ドロップも可`}
              onClick={() => { if (!disabled) setPicker({ cardId: card.id, role }) }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={(e) => onDrop(e, card.id, role)}
            >
              {thumb && isReady ? <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} onError={() => patchSlot(card.id, role, { status: 'error', error: '写真が見つかりません', path: null, file: undefined })} /> : null}
              {slot.status === 'uploading' && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.6)' }}><CircleNotch size={16} className="animate-spin" /></div>}
              {!isReady && slot.status !== 'uploading' && (
                <div className="flex flex-col items-center gap-0.5" style={{ color: slot.status === 'error' ? '#EF4444' : 'var(--text-secondary)' }}>
                  <CutRoleIcon role={role} size={small ? 18 : 24} />
                  <span className="text-[10px] font-medium">{roleDef.label}{required ? ' *' : ''}</span>
                  {sharedWith && <span className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>ショット {sharedWith} と同じ写真</span>}
                  {slot.status === 'error' && <span className="text-[9px]">{slot.error === '写真が見つかりません' ? '見つかりません・入れ直し' : '失敗'}</span>}
                </div>
              )}
              {/* 左上: この枠の意味（始点 / 終点 / 参照 / 主カット） */}
              <span className="absolute top-1 left-1 px-1 rounded text-[9px] leading-4" style={isReady ? { background: 'rgba(0,0,0,0.55)', color: '#fff' } : { background: 'var(--bg-surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}>{tag}</span>
              {isReady && (
                <>
                  <span className="absolute bottom-1 left-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>{roleDef.label}</span>
                  <button type="button" className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-white nodrag" style={{ background: 'rgba(0,0,0,0.55)' }} title="このカットを外す（同じ役割の枠すべてから外れます）" onClick={(e) => { e.stopPropagation(); patchSlot(card.id, role, { status: 'empty', path: null, name: undefined, width: undefined, height: undefined, file: undefined }) }}><X size={10} /></button>
                </>
              )}
            </div>
          )
        }
        // ショットの枠組み: 番号と秒数の見出し + 始点 [→ 終点]。カットが揃ったショットだけ番号に色、揃っていなければ飛ばす
        const shotBox = (s: VideoShotSpec, i: number) => {
          const ok = available.includes(i)
          const missing = [s.role, ...(s.endRole ? [s.endRole] : [])].filter((r) => !ready(r)).map((r) => CUT_ROLE_LABEL[r])
          return (
            <div key={i} className={`rounded-xl p-1.5 flex flex-col gap-1 ${s.endRole ? 'col-span-2' : ''}`} style={{ border: `1px solid ${ok ? 'var(--border-active)' : 'var(--border)'}`, background: 'var(--bg-surface)' }} title={ok ? `ショット ${i + 1}: ${shotRoleLabel(s)}・${s.duration} 秒` : `ショット ${i + 1}（${shotRoleLabel(s)}）: ${missing.join('・')} のカットが無いと飛ばします`}>
              <div className="flex items-center gap-1 px-0.5 text-[10px]">
                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] tabular-nums shrink-0" style={{ background: ok ? CUT_SET_ACCENT : 'var(--border)', color: ok ? '#fff' : 'var(--text-tertiary)' }}>{i + 1}</span>
                <span className="font-medium truncate" style={{ color: ok ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{shotRoleLabel(s)}</span>
                <span className="ml-auto tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>{s.duration} 秒{!ok && anyReady ? '・飛ばします' : ''}</span>
              </div>
              <div className="relative grid gap-1.5" style={{ gridTemplateColumns: s.endRole ? '1fr 1fr' : '1fr' }}>
                {renderSlot(s.role, '始点', false, i)}
                {s.endRole && (
                  <>
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-active)', color: 'var(--text-secondary)' }} title="始点の写真から終点の写真へ動かします"><ArrowRight size={10} weight="bold" /></span>
                    {renderSlot(s.endRole, '終点', false, i)}
                  </>
                )}
              </div>
            </div>
          )
        }
        return (
          <div key={card.id} className="rounded-lg p-2.5 flex flex-col gap-2" style={{ background: 'var(--bg-canvas)', border: `1px solid ${isCurrent ? CUT_SET_ACCENT : 'var(--border)'}` }}>
            <div className="flex items-center gap-2">
              {onMakeCurrent && (
                <button type="button" className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-elevated)] nodrag shrink-0" title={isCurrent ? '対話実行で流す SKU' : 'この SKU を対話実行で流す（★）'} onClick={() => onMakeCurrent(card.id)}>
                  <Star size={13} weight={isCurrent ? 'fill' : 'regular'} style={{ color: isCurrent ? CUT_SET_ACCENT : 'var(--text-tertiary)' }} />
                </button>
              )}
              <input
                value={card.sku}
                onChange={(e) => onChange((list) => list.map((c) => (c.id === card.id ? { ...c, sku: e.target.value } : c)))}
                className="flex-1 min-w-0 h-7 rounded px-2 text-[12px] font-medium focus:outline-none nodrag"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                placeholder="SKU（商品の管理番号）"
                title="SKU = 商品の管理番号（1 つの商品 = 1 SKU）。書き出すファイル名・フォルダ名・結果の見出しに使います"
                onKeyDown={(e) => e.stopPropagation()}
                disabled={disabled}
              />
              {shots.length > 0 && <span className="text-[10px] tabular-nums shrink-0" style={{ color: noShots ? '#EF4444' : 'var(--text-tertiary)' }} title={noShots ? 'この構成で作れるショットがありません。必要なカット（終了カットを指定したショットは両方）を入れてください' : 'この SKU で作るショット数 / 構成のショット数'}>{available.length} / {shots.length} ショット</span>}
              <button type="button" className="h-7 px-2 rounded-md text-[11px] flex items-center gap-1 shrink-0 hover:bg-[var(--bg-elevated)] nodrag" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} title="ライブラリに登録したモデルの写真を、役割ごとの枠に一度に入れる" onClick={() => setModelPickerFor(card.id)} disabled={disabled}>
                <UserCircle size={13} />{compact ? '' : 'モデル'}
              </button>
              {cards.length > 1 && <button type="button" className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-elevated)] nodrag" style={{ color: 'var(--text-tertiary)' }} title="この SKU を外す" onClick={() => onChange((list) => list.filter((c) => c.id !== card.id))} disabled={disabled}><Trash size={12} /></button>}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {!frontInShots && (
                <div className="rounded-xl p-1.5 flex flex-col gap-1" style={{ border: `1px solid ${ready(FRONTAL_ROLE) ? 'var(--border-active)' : 'var(--border)'}`, background: 'var(--bg-surface)' }} title="正面は動画の主カット（AI に渡す基準の写真）です。この構成のショットには出ませんが必須です">
                  <div className="flex items-center gap-1 px-0.5 text-[10px]"><span className="font-medium" style={{ color: 'var(--text-secondary)' }}>主カット</span></div>
                  {renderSlot(FRONTAL_ROLE, '主カット')}
                </div>
              )}
              {shots.map(shotBox)}
            </div>
            {otherRoles.length > 0 && (
              <>
                <div className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                  <span className="text-[10px] font-medium shrink-0" style={{ color: 'var(--text-secondary)' }}>{shots.length > 0 ? '補足カット（任意）' : '役割ごとのカット'}</span>
                  <span className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }} title={shots.length > 0 ? '補足カットは動画の角度には使いません。同じ服の別角度として AI に渡し、見え方を揃えるためだけに使います' : '役割のポートを Video Generation の開始・終了フレームにつなぐと、その役割が始点・終点の枠になります'}>{shots.length > 0 ? '動画には出ません。服の見え方を揃える参照用' : 'つないだ役割が始点・終点の枠になります'}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 opacity-80">{otherRoles.map((r) => renderSlot(r.id, '参照', true))}</div>
              </>
            )}
          </div>
        )
      })}
      <ModelPickerDialog open={!!modelPickerFor} onClose={() => setModelPickerFor(null)} onPick={(model, items) => {
        const cardId = modelPickerFor; if (!cardId) return
        // モデルの写真を役割ごとに、この処理用の置き場（batch バケット）へ複製して枠に入れる
        const byId = new Map(items.map((it) => [it.id, it]))
        void touchLibraryItems(items.map((it) => it.id))
        for (const r of CUT_ROLES) {
          const id = model.cuts[r.id]; const it = id ? byId.get(id) : undefined
          if (!it) continue
          void pickedToFiles([{ url: libraryCanonicalUrl(it), media: 'image', name: it.name, libraryItemId: it.id }]).then(([f]) => { if (f) void upload(cardId, r.id, f) }).catch((e) => showToast(`${r.label}: ${e instanceof Error ? e.message : String(e)}`, 'error'))
        }
      }} />
      <div className="flex items-center gap-2">
        <button type="button" className="flex-1 h-8 rounded-lg text-[12px] flex items-center justify-center gap-1 hover:bg-[var(--bg-elevated)] nodrag" style={{ border: '1px dashed var(--border-active)', color: 'var(--text-secondary)' }} onClick={addCard} disabled={disabled || cards.length >= MAX_SKUS}>
          <Plus size={12} />SKU を追加
        </button>
        {(cards.length > 1 || cards.some((c) => CUT_ROLES.some((r) => c.cuts[r.id].status !== 'empty'))) && (
          <button type="button" className="h-8 px-2 rounded-lg text-[11px] hover:bg-[var(--bg-elevated)] shrink-0 nodrag" style={{ color: 'var(--text-tertiary)' }} title="カードと入れた写真をすべて外して最初から（投入済みの処理には影響しません）" onClick={() => onChange([newCard(1)])} disabled={disabled}>すべて外す</button>
        )}
      </div>
    </div>
  )
}
