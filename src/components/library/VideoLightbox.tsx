// 動画の拡大表示（ライブラリの商品動画カードなど。GenerationCard の拡大表示と同じ見た目）
import { createPortal } from 'react-dom'
import { Download, X } from '@phosphor-icons/react'

export function VideoLightbox({ url, onClose, onDownload }: { url: string; onClose: () => void; onDownload: () => void }) {
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.9)', zIndex: 99999 }} onClick={onClose}>
      <div className="relative rounded-xl overflow-hidden" style={{ maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <video src={url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '90vh', display: 'block' }} />
        <div className="absolute top-3 right-3 flex gap-2">
          <button className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={(e) => { e.stopPropagation(); onDownload() }} title="ダウンロード"><Download size={15} weight="bold" /></button>
          <button className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose} title="閉じる"><X size={16} weight="bold" /></button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
