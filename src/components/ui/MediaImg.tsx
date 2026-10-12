// 署名 URL のメディア表示（画像 / 動画）。失効なら 1 回だけ再署名し、それでも読めない（保持期限で消えた等）ときは fallback を出す。
// 壊れた画像アイコンをページに出さないための共通部品
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { ImageSquare } from '@phosphor-icons/react'
import { useSignedMedia } from '../../hooks/useSignedMedia'

interface Props {
  src: string
  alt?: string
  className?: string
  style?: CSSProperties
  video?: boolean
  muted?: boolean
  loop?: boolean
  autoPlay?: boolean
  playsInline?: boolean
  fallback?: ReactNode          // 読めないときに出すもの（既定: 薄いアイコン）
  fallbackClassName?: string    // 既定 fallback の入れ物のクラス（大きさ合わせ）
  onClick?: () => void
  onMouseEnter?: MouseEventHandler<HTMLElement>
  onMouseLeave?: MouseEventHandler<HTMLElement>
  draggable?: boolean
}

export function MediaImg({ src, alt = '', className, style, video, muted, loop, autoPlay, playsInline, fallback, fallbackClassName, onClick, onMouseEnter, onMouseLeave, draggable }: Props) {
  const { url, onError, failed } = useSignedMedia(src)
  if (failed || !url) {
    return fallback !== undefined ? <>{fallback}</> : (
      <div className={`flex items-center justify-center ${fallbackClassName ?? className ?? ''}`} style={{ ...style, color: 'var(--text-tertiary)', background: 'var(--bg-elevated)' }} title="ファイルを読み込めません（保持期限が切れて削除された可能性があります）">
        <ImageSquare size={20} />
      </div>
    )
  }
  if (video) return <video src={url} className={className} style={style} muted={muted} loop={loop} autoPlay={autoPlay} playsInline={playsInline} onError={onError} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
  return <img src={url} alt={alt} className={className} style={style} onError={onError} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} draggable={draggable} />
}
