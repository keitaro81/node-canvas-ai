import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ImageIcon, X, Loader2 } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { fal } from '../../lib/ai/fal-client'
import type { ReferenceImageNodeData } from '../../types/nodes'

function ReferenceImageNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ReferenceImageNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const displayUrl = nodeData.uploadedImagePreview || nodeData.imageUrl || null

  const uploadFile = useCallback(
    async (file: File) => {
      const previewUrl = URL.createObjectURL(file)
      updateNode(id, { uploadedImagePreview: previewUrl } as Parameters<typeof updateNode>[1])
      setIsUploading(true)

      try {
        const uploadedUrl = await fal.storage.upload(file)
        updateNode(id, {
          imageUrl: uploadedUrl,
          uploadedImagePreview: previewUrl,
        } as Parameters<typeof updateNode>[1])
      } catch {
        updateNode(id, {
          imageUrl: null,
          uploadedImagePreview: null,
        } as Parameters<typeof updateNode>[1])
      } finally {
        setIsUploading(false)
      }
    },
    [id, updateNode]
  )

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ''
      await uploadFile(file)
    },
    [uploadFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      const imageItemCount = Array.from(e.dataTransfer.items).filter(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      ).length
      // 複数ファイルの場合はキャンバスに委譲（ハイライトしない）
      if (imageItemCount > 1) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // relatedTarget がノード内なら無視（子要素への移動）
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      const imageFiles = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      // 複数ファイルの場合はキャンバスに委譲して新規ノード生成
      if (imageFiles.length > 1) {
        setIsDragOver(false)
        return
      }

      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      await uploadFile(imageFiles[0])
    },
    [uploadFile]
  )

  const handleClear = useCallback(() => {
    updateNode(id, { imageUrl: null, uploadedImagePreview: null } as Parameters<typeof updateNode>[1])
  }, [id, updateNode])

  return (
    <div
      className={[
        'node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible border transition-all duration-150',
        selected
          ? 'border-[#8B5CF6] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
          : 'border-[#27272A]',
      ].join(' ')}
      style={{ background: '#111113' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[#27272A]" style={{ minHeight: 36 }}>
        <div className="w-0.5 h-4 rounded-full shrink-0" style={{ background: '#8B5CF6' }} />
        <ImageIcon size={14} className="shrink-0" style={{ color: '#8B5CF6' }} />
        <span className="flex-1 text-[13px] font-semibold text-[#FAFAFA] truncate">{nodeData.label}</span>
      </div>

      {/* Body */}
      <div
        className="px-3 py-3 nodrag"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {displayUrl ? (
          <div
            className="relative rounded-lg overflow-hidden transition-all duration-150"
            style={{ border: isDragOver ? '1px dashed #8B5CF6' : '1px solid #27272A' }}
          >
            <img
              src={displayUrl}
              alt="Reference"
              className="w-full h-auto block"
            />
            {isDragOver && !isUploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ background: 'rgba(139,92,246,0.2)', border: '1px dashed #8B5CF6' }}>
                <span className="text-[12px] font-medium" style={{ color: '#8B5CF6' }}>ここにドロップ</span>
              </div>
            )}
            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                <Loader2 size={20} className="animate-spin text-white" />
              </div>
            )}
            {!isUploading && !isDragOver && (
              <button
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center nodrag"
                style={{ background: 'rgba(0,0,0,0.65)' }}
                onClick={handleClear}
                title="削除"
              >
                <X size={12} color="white" />
              </button>
            )}
          </div>
        ) : (
          <label
            htmlFor={`ref-image-upload-${id}`}
            className="flex flex-col items-center justify-center gap-2 rounded-lg py-6 cursor-pointer transition-colors nodrag"
            style={{ border: isDragOver ? '1px dashed #8B5CF6' : '1px dashed #27272A', minHeight: 120, background: isDragOver ? 'rgba(139,92,246,0.08)' : undefined }}
          >
            {isUploading ? (
              <Loader2 size={20} className="animate-spin" style={{ color: '#8B5CF6' }} />
            ) : (
              <>
                <ImageIcon size={24} color="#3F3F46" />
                <span className="text-[12px]" style={{ color: '#8B5CF6' }}>クリックしてアップロード</span>
                <span className="text-[11px]" style={{ color: '#71717A' }}>PNG / JPEG / WebP</span>
              </>
            )}
          </label>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          className="hidden"
          id={`ref-image-upload-${id}`}
        />
      </div>

      {/* Output handle */}
      <Handle
        id="out-image"
        type="source"
        position={Position.Right}
        style={{
          top: '50%',
          width: 20,
          height: 20,
          background: 'radial-gradient(circle, #8B5CF6 3px, #111113 3px 5px, transparent 5px)',
          border: 'none',
          borderRadius: 0,
        }}
      />
    </div>
  )
}

export const ReferenceImageNode = memo(function ReferenceImageNodeWrapper(props: NodeProps) {
  return (
    <div className="group">
      <ReferenceImageNodeInner {...props} />
    </div>
  )
})
