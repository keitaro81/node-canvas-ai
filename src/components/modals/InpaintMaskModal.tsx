import { useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, Loader2 } from 'lucide-react'
import { fal } from '../../lib/ai/fal-client'

interface Props {
  imageUrl: string
  initialPreviewDataUrl?: string | null
  onConfirm: (maskUrl: string, previewDataUrl: string) => void
  onClose: () => void
}

export function InpaintMaskModal({ imageUrl, initialPreviewDataUrl, onConfirm, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const [brushSize, setBrushSize] = useState(30)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const brushSizeRef = useRef(brushSize)

  useEffect(() => {
    brushSizeRef.current = brushSize
    // ブラシサイズ変更をカーソル要素に直接反映（state 更新なし）
    const cursor = cursorRef.current
    if (cursor) {
      cursor.style.width = `${brushSize}px`
      cursor.style.height = `${brushSize}px`
    }
  }, [brushSize])

  const initialPreviewRef = useRef(initialPreviewDataUrl)

  // 画像ロード時にキャンバスサイズを同期し、既存のマスクを復元
  useEffect(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return

    const restorePreview = () => {
      const dataUrl = initialPreviewRef.current
      if (!dataUrl) return
      const preview = new Image()
      preview.onload = () => {
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(preview, 0, 0, canvas.width, canvas.height)
      }
      preview.src = dataUrl
    }

    const sync = () => {
      canvas.width = img.clientWidth
      canvas.height = img.clientHeight
      restorePreview()
    }
    if (img.complete && img.naturalWidth) sync()
    img.addEventListener('load', sync)
    window.addEventListener('resize', sync)
    return () => {
      img.removeEventListener('load', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  const getPos = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // カーソル位置を DOM 直接操作で更新（re-render なし）
  const moveCursor = (pos: { x: number; y: number }) => {
    const cursor = cursorRef.current
    if (!cursor) return
    cursor.style.left = `${pos.x}px`
    cursor.style.top = `${pos.y}px`
    cursor.style.display = 'block'
  }

  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(34, 197, 94, 1.0)'
    ctx.lineWidth = brushSizeRef.current
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDrawing(true)
    const pos = getPos(e)
    lastPos.current = pos
    drawLine(pos, pos)
    moveCursor(pos)
  }, [drawLine])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getPos(e)
    moveCursor(pos)
    if (!isDrawing) return
    e.preventDefault()
    if (lastPos.current) drawLine(lastPos.current, pos)
    lastPos.current = pos
  }, [isDrawing, drawLine])

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false)
    lastPos.current = null
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsDrawing(false)
    lastPos.current = null
    if (cursorRef.current) cursorRef.current.style.display = 'none'
  }, [])

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  const handleConfirm = useCallback(async () => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return

    setIsUploading(true)
    try {
      // ピクセル変換前に描画内容をプレビュー用として保存
      const previewDataUrl = canvas.toDataURL('image/png')

      const naturalW = img.naturalWidth || canvas.width
      const naturalH = img.naturalHeight || canvas.height

      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = naturalW
      maskCanvas.height = naturalH
      const maskCtx = maskCanvas.getContext('2d')!

      maskCtx.drawImage(canvas, 0, 0, naturalW, naturalH)

      // 描画済み → 白・不透明（編集箇所）、未描画 → 黒・不透明（保持箇所）
      // fal.ai GPT-image-2 は SD 系と同じく白=編集・黒=保持の形式
      const imgData = maskCtx.getImageData(0, 0, naturalW, naturalH)
      const d = imgData.data
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) {
          // 描画済み → 白（編集箇所）
          d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255
        } else {
          // 未描画 → 黒（保持箇所）
          d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255
        }
      }
      maskCtx.putImageData(imgData, 0, 0)

      const blob = await new Promise<Blob>((resolve, reject) => {
        maskCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
      })
      const file = new File([blob], 'mask.png', { type: 'image/png' })
      const maskUrl = await fal.storage.upload(file)
      onConfirm(maskUrl, previewDataUrl)
    } catch (err) {
      console.error('Mask upload failed:', err)
    } finally {
      setIsUploading(false)
    }
  }, [onConfirm])

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99999 }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-xl overflow-hidden"
        style={{ background: '#111113', border: '1px solid #27272A', maxWidth: '90vw', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div
          className="flex items-center justify-between px-4 h-11 shrink-0"
          style={{ borderBottom: '1px solid #27272A' }}
        >
          <span className="text-[13px] font-semibold" style={{ color: '#FAFAFA' }}>マスク描画</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded flex items-center justify-center transition-colors"
            style={{ color: '#71717A' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* 画像 + 描画キャンバス */}
        <div style={{ position: 'relative', display: 'inline-block', flex: 1, overflow: 'hidden' }}>
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            style={{ display: 'block', maxWidth: '80vw', maxHeight: '70vh', objectFit: 'contain' }}
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              cursor: 'none',
              touchAction: 'none',
              opacity: 0.7,
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          />
          {/* カスタムカーソル: ブラシサイズの円 + 中央に + */}
          <div
            ref={cursorRef}
            style={{
              display: 'none',
              position: 'absolute',
              width: brushSize,
              height: brushSize,
              transform: 'translate(-50%, -50%)',
              border: '1.5px solid white',
              borderRadius: '50%',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* ツールバー */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0 gap-6"
          style={{ borderTop: '1px solid #27272A' }}
        >
          {/* ブラシサイズ */}
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-medium shrink-0" style={{ color: '#71717A' }}>ブラシ</span>
            <input
              type="range"
              min={5}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              style={{ width: 110, accentColor: '#22C55E' }}
            />
            <span className="text-[11px] w-5 text-right tabular-nums" style={{ color: '#A1A1AA' }}>
              {brushSize}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* クリア */}
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] transition-colors"
              style={{ border: '1px solid #3F3F46', color: '#A1A1AA', background: 'transparent' }}
            >
              <Trash2 size={12} />
              クリア
            </button>
            {/* 適用 */}
            <button
              onClick={handleConfirm}
              disabled={isUploading}
              className="flex items-center gap-1.5 px-4 h-8 rounded-lg text-[12px] font-medium text-white transition-opacity"
              style={{ background: '#8B5CF6', opacity: isUploading ? 0.7 : 1 }}
            >
              {isUploading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  処理中...
                </>
              ) : '適用'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
