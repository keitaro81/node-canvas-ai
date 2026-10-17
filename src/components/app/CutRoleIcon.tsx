// 商品動画 App のカット役割アイコン（2026-10-17・ユーザー要望: 矢印ではなく人物のシルエットで向きが分かるように）
// 正面 / 背面 = 胸像（正面は首と襟元の V、背面は髪が首を隠して肩へ広がる）、右側面 / 左側面 = 横顔の胸像（顔の向き = ラベルの向き）、
// ディテール = 開いた襟・前立て・胸ポケットの寄り、全身 = 立ち姿
import type { CSSProperties } from 'react'
import type { CutRole } from '../../lib/video/productVideo'

export function CutRoleIcon({ role, size = 20, style }: { role: CutRole; size?: number; style?: CSSProperties }) {
  // 右向きの横顔の胸像。左側面はこれを左右反転
  const profile = (
    <>
      <circle cx="12.8" cy="7.4" r="3.2" />
      <path d="M15.9 6.6l1.3 1.3-1.2 1" />
      <path d="M6.5 20.5l2.9-6.9c1.8-.5 3.8-.3 5.6.8 1.8 1.2 2.5 3.4 2.6 6.1" />
    </>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {role === 'front' && (
        <>
          <circle cx="12" cy="7.5" r="3.5" />
          <path d="M4.5 20.5c0-4.6 3.3-7 7.5-7s7.5 2.4 7.5 7" />
          <path d="M10.2 13.8l1.8 2.6 1.8-2.6" />
        </>
      )}
      {role === 'back' && (
        <>
          <path d="M8.5 7.6a3.5 3.5 0 1 1 7 0" />
          <path d="M8.5 7.6c0 2.6-.5 4.4-1.4 6.2" />
          <path d="M15.5 7.6c0 2.6.5 4.4 1.4 6.2" />
          <path d="M4.5 20.5c0-4.6 3.3-7 7.5-7s7.5 2.4 7.5 7" />
        </>
      )}
      {role === 'right' && profile}
      {role === 'left' && <g transform="scale(-1 1) translate(-24 0)">{profile}</g>}
      {role === 'detail' && (
        <>
          <path d="M12 10.2L8.4 5.5 6.3 10.8z" />
          <path d="M12 10.2l3.6-4.7 2.1 5.3z" />
          <path d="M12 10.2v10.3" />
          <rect x="14.4" y="13.2" width="4" height="3.4" rx="0.5" />
        </>
      )}
      {role === 'full' && (
        <>
          <circle cx="12" cy="4.6" r="2.3" />
          <path d="M9.3 8.3h5.4l1.5 6.3h-1.6l-.5 6.4h-4.2l-.5-6.4H7.8z" />
          <path d="M12 15.2V21" />
        </>
      )}
    </svg>
  )
}
