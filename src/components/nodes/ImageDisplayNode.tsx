import { memo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { type NodeProps, useNodes, useEdges } from '@xyflow/react'
import { Monitor, Download, Maximize2, ImageIcon, X } from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '../../types/nodes'

export const ImageDisplayNode = memo(function ImageDisplayNode(props: NodeProps) {
  const data = props.data as NodeData
  const nodes = useNodes()
  const edges = useEdges()
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)

  // 接続元ノード（ImageGenerationNode）の output をリアクティブに読む
  // → 接続した瞬間・生成完了時に自動で画像が表示される
  const incomingEdge = edges.find(
    (e) => e.target === props.id && e.targetHandle === 'in-image-image-in'
  )
  const sourceNode = incomingEdge ? nodes.find((n) => n.id === incomingEdge.source) : null
  const imageUrl =
    ((sourceNode?.data as NodeData)?.output as string | undefined) ||
    (data.output as string | undefined) ||
    (data.params?.imageUrl as string | undefined) ||
    null

  useEffect(() => {
    setImgSize(null)
  }, [imageUrl])

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!imageUrl) return
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'node-canvas-image.png'
      link.click()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(imageUrl, '_blank')
    }
  }

  return (
    <>
      <BaseNode
        {...props}
        data={data}
        icon={<Monitor size={14} />}
        inputs={[{ id: 'image-in', portType: 'image' }]}
        outputs={[{ id: 'image-out', portType: 'image' }]}
      >
        {imageUrl ? (
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
                onLoad={(e) => {
                  const img = e.currentTarget
                  setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
                }}
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 opacity-0 group-hover/img:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.6)' }}>
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
            {imgSize && (
              <div className="text-[11px] text-[var(--text-tertiary)] text-center py-1.5">
                {imgSize.w} × {imgSize.h}
              </div>
            )}
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

      {/* Lightbox — rendered via portal to escape React Flow stacking context */}
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
    </>
  )
})
