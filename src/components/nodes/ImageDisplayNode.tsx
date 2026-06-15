import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { type NodeProps, useNodes, useEdges } from '@xyflow/react'
import { Monitor, Download, Maximize2, ImageIcon, ImageOff, X, Loader2, AlertCircle, Paintbrush } from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '../../types/nodes'
import { useCanvasStore } from '../../stores/canvasStore'
import { InpaintMaskModal } from '../modals/InpaintMaskModal'
import { downloadFile } from '../../lib/downloadFile'
import { useSignedMedia } from '../../hooks/useSignedMedia'

export const ImageDisplayNode = memo(function ImageDisplayNode(props: NodeProps) {
  const data = props.data as NodeData
  const nodes = useNodes()
  const edges = useEdges()
  const updateNode = useCanvasStore((s) => s.updateNode)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [showMaskModal, setShowMaskModal] = useState(false)

  const incomingEdge = edges.find(
    (e) => e.target === props.id && e.targetHandle === 'in-image-image-in'
  )
  const sourceNode = incomingEdge ? nodes.find((n) => n.id === incomingEdge.source) : null
  const rawImageUrl =
    (data.output as string | undefined) ||
    ((sourceNode?.data as NodeData)?.output as string | undefined) ||
    (data.params?.imageUrl as string | undefined) ||
    null
  // 非公開バケット化: 失効/取りこぼし時に再署名する安全網（imgFailed もフックが管理）
  const { url: imageUrl, onError: onImageError, failed: imgFailed, freshUrl } = useSignedMedia(rawImageUrl)

  const maskUrl = (data.params?.maskUrl as string | undefined) || null
  const maskPreviewDataUrl = (data.params?.maskPreviewDataUrl as string | undefined) || null

  const status = (data.status as string) ?? 'idle'
  const isGenerating = status === 'generating'
  const isError = status === 'error'
  const isDeleted = (data as { deleted?: boolean }).deleted === true
  const errorMsg = data.params?.error as string | undefined

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = await freshUrl()
    if (url) downloadFile(url, 'node-canvas-image.png')
  }

  const handleMaskConfirm = (url: string, previewDataUrl: string) => {
    updateNode(props.id, { params: { ...data.params, maskUrl: url, maskPreviewDataUrl: previewDataUrl } } as never)
    setShowMaskModal(false)
  }

  const handleMaskClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    updateNode(props.id, { params: { ...data.params, maskUrl: null, maskPreviewDataUrl: null } } as never)
  }

  return (
    <>
      <BaseNode
        {...props}
        data={data}
        icon={<Monitor size={14} />}
        inputs={[{ id: 'image-in', portType: 'image' }]}
        outputs={[{ id: 'image-out', portType: 'image' }]}
        hideStatus
      >
        {isGenerating ? (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg py-10"
            style={{ border: '1px dashed var(--border)', minHeight: 120 }}
          >
            <Loader2 size={24} className="animate-spin" style={{ color: '#8B5CF6' }} />
            <span className="text-[11px] text-[var(--text-tertiary)]">生成中...</span>
          </div>
        ) : isError ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg py-8 px-3"
            style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', minHeight: 80 }}
          >
            <AlertCircle size={20} style={{ color: '#EF4444' }} />
            <span className="text-[11px] text-center" style={{ color: '#EF4444' }}>{errorMsg || '生成に失敗しました'}</span>
          </div>
        ) : (isDeleted || imgFailed) ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg py-8 px-3"
            style={{ border: '1px dashed var(--border)', minHeight: 80 }}
          >
            <ImageOff size={20} style={{ color: 'var(--text-tertiary)' }} />
            <span className="text-[11px] text-center" style={{ color: 'var(--text-tertiary)' }}>画像を表示できません</span>
          </div>
        ) : imageUrl ? (
          <>
            <div
              className="relative rounded-lg overflow-hidden group/img cursor-pointer"
              style={{ border: '1px solid var(--border)' }}
              onClick={() => setLightboxOpen(true)}
            >
              <img
                src={imageUrl}
                alt="Display"
                className="w-full h-auto block"
                onError={onImageError}
              />
              {maskPreviewDataUrl && (
                <img
                  src={maskPreviewDataUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  style={{ opacity: 0.6 }}
                />
              )}
              {/* Hover overlay */}
              <div className="absolute inset-0 opacity-0 group-hover/img:opacity-100 transition-opacity duration-150 flex items-end justify-between p-1.5" style={{ background: 'rgba(0,0,0,0.6)' }}>
                <div className="flex items-center gap-1">
                  {/* ペイントアイコン */}
                  <button
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-colors nodrag"
                    style={{ background: maskUrl ? 'rgba(34,197,94,0.85)' : 'rgba(255,255,255,0.15)' }}
                    onClick={(e) => { e.stopPropagation(); setShowMaskModal(true) }}
                    title="マスク描画"
                  >
                    <Paintbrush size={14} />
                  </button>
                  {maskUrl && (
                    <button
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full nodrag"
                      style={{ background: 'rgba(34,197,94,0.85)' }}
                      onClick={handleMaskClear}
                      title="マスクを削除"
                    >
                      <span className="text-[10px] text-white font-medium leading-none">Mask</span>
                      <X size={8} color="white" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-colors nodrag"
                    style={{ background: 'rgba(255,255,255,0.15)' }}
                    onClick={handleDownload}
                    title="ダウンロード"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-colors nodrag"
                    style={{ background: 'rgba(255,255,255,0.15)' }}
                    onClick={(e) => { e.stopPropagation(); setLightboxOpen(true) }}
                    title="拡大"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg py-8"
            style={{ border: '1px dashed var(--border)', minHeight: 120 }}
          >
            <ImageIcon size={32} color="var(--border-active)" />
            <span className="text-[11px] text-[var(--text-tertiary)]">画像を接続してください</span>
          </div>
        )}
      </BaseNode>

      {/* Lightbox */}
      {lightboxOpen && imageUrl && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99999 }}
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative rounded-xl overflow-hidden"
            style={{ maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={imageUrl}
              alt="Lightbox"
              style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', display: 'block' }}
            />
            <button
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              onClick={() => setLightboxOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* マスク描画モーダル */}
      {showMaskModal && imageUrl && (
        <InpaintMaskModal
          imageUrl={imageUrl}
          initialPreviewDataUrl={maskPreviewDataUrl}
          onConfirm={handleMaskConfirm}
          onClose={() => setShowMaskModal(false)}
        />
      )}
    </>
  )
})
