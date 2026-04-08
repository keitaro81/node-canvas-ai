import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Film, X, Loader2, Play, Pause } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { uploadVideoFile } from '../../lib/api/storage'
import type { ReferenceVideoNodeData, NodeData, CapsuleFieldDef, CapsuleVisibility } from '../../types/nodes'
import { CapsuleFieldToggle } from './CapsuleFieldToggle'

const ACCEPTED_VIDEO_TYPES = 'video/mp4,video/quicktime,video/webm'

function ReferenceVideoNodeInner({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ReferenceVideoNodeData
  const updateNode = useCanvasStore((s) => s.updateNode)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  // blob: URLはリロードで無効になるため、videoUrl（永続URL）を優先
  const displayUrl = (() => {
    const preview = nodeData.uploadedVideoPreview
    if (preview && !preview.startsWith('blob:')) return preview
    return nodeData.videoUrl || preview || null
  })()

  const uploadFile = useCallback(
    async (file: File) => {
      const previewUrl = URL.createObjectURL(file)
      updateNode(id, { uploadedVideoPreview: previewUrl } as Parameters<typeof updateNode>[1])
      setIsUploading(true)

      try {
        const uploadedUrl = await uploadVideoFile(file, id)
        updateNode(id, {
          videoUrl: uploadedUrl,
          uploadedVideoPreview: uploadedUrl,
        } as Parameters<typeof updateNode>[1])
      } catch {
        updateNode(id, {
          videoUrl: null,
          uploadedVideoPreview: null,
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
      const videoItems = Array.from(e.dataTransfer.items).filter(
        (item) => item.kind === 'file' && item.type.startsWith('video/')
      )
      if (videoItems.length !== 1) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      const videoFiles = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/'))
      if (videoFiles.length !== 1) {
        setIsDragOver(false)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      await uploadFile(videoFiles[0])
    },
    [uploadFile]
  )

  const handleClear = useCallback(() => {
    updateNode(id, { videoUrl: null, uploadedVideoPreview: null } as Parameters<typeof updateNode>[1])
  }, [id, updateNode])

  const capsuleFields = ((data as unknown as NodeData).capsuleFields ?? {}) as Record<string, CapsuleFieldDef>
  function getCapsuleVisibility(fieldId: string): CapsuleVisibility {
    return capsuleFields[fieldId]?.capsuleVisibility ?? 'visible'
  }
  function handleCapsuleChange(fieldId: string, visibility: CapsuleVisibility) {
    const updated: Record<string, CapsuleFieldDef> = {
      ...capsuleFields,
      [fieldId]: { id: fieldId, capsuleVisibility: visibility },
    }
    updateNode(id, { capsuleFields: updated } as Parameters<typeof updateNode>[1])
  }

  return (
    <div
      className={[
        'node-popin relative flex flex-col w-[280px] rounded-xl overflow-visible border transition-all duration-150',
        selected
          ? 'border-[#EC4899] shadow-[0_0_0_1px_rgba(236,72,153,0.3)]'
          : 'border-[var(--border)]',
      ].join(' ')}
      style={{ background: 'var(--bg-surface)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border)]" style={{ minHeight: 36 }}>
        <div className="w-0.5 h-4 rounded-full shrink-0" style={{ background: '#EC4899' }} />
        <Film size={14} className="shrink-0" style={{ color: '#EC4899' }} />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{(nodeData as unknown as NodeData).label ?? nodeData.label}</span>
        <CapsuleFieldToggle
          fieldId="videoUrl"
          visibility={getCapsuleVisibility('videoUrl')}
          onChange={handleCapsuleChange}
        />
        <button
          className="w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity nodrag"
          style={{ color: 'var(--text-tertiary)' }}
          onClick={() => useCanvasStore.getState().removeNode(id)}
          title="削除"
        >
          <X size={12} />
        </button>
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
            className="relative rounded-lg overflow-hidden transition-all duration-150 group/vid"
            style={{ border: isDragOver ? '1px dashed #EC4899' : '1px solid var(--border)', background: '#000' }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <video
              src={displayUrl}
              className="w-full h-auto block"
              style={{ maxHeight: 140, objectFit: 'contain' }}
              loop
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={(e) => {
                const v = e.currentTarget
                v.paused ? v.play() : v.pause()
              }}
            />
            {/* Play/pause overlay */}
            {!isDragOver && !isUploading && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/vid:opacity-100 transition-opacity duration-150 pointer-events-none">
                <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
                  {isPlaying
                    ? <Pause size={16} className="text-white" />
                    : <Play size={16} className="text-white" />
                  }
                </div>
              </div>
            )}
            {isDragOver && !isUploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg" style={{ background: 'rgba(236,72,153,0.2)', border: '1px dashed #EC4899' }}>
                <span className="text-[12px] font-medium" style={{ color: '#EC4899' }}>ここにドロップ</span>
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
            htmlFor={`ref-video-upload-${id}`}
            className="flex flex-col items-center justify-center gap-2 rounded-lg py-6 cursor-pointer transition-colors nodrag"
            style={{
              border: isDragOver ? '1px dashed #EC4899' : '1px dashed #27272A',
              minHeight: 120,
              background: isDragOver ? 'rgba(236,72,153,0.08)' : undefined,
            }}
          >
            {isUploading ? (
              <Loader2 size={20} className="animate-spin" style={{ color: '#EC4899' }} />
            ) : (
              <>
                <Film size={24} color="var(--border-active)" />
                <span className="text-[12px]" style={{ color: '#EC4899' }}>クリックしてアップロード</span>
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>MP4 / MOV / WebM</span>
              </>
            )}
          </label>
        )}
        <input
          type="file"
          accept={ACCEPTED_VIDEO_TYPES}
          onChange={handleFileChange}
          className="hidden"
          id={`ref-video-upload-${id}`}
        />
      </div>

      {/* Output handle */}
      <Handle
        id="out-video"
        type="source"
        position={Position.Right}
        style={{
          top: '50%',
          width: 20,
          height: 20,
          background: 'radial-gradient(circle, #EC4899 3px, var(--bg-surface) 3px 5px, transparent 5px)',
          border: 'none',
          borderRadius: 0,
        }}
      />
    </div>
  )
}

export const ReferenceVideoNode = memo(function ReferenceVideoNodeWrapper(props: NodeProps) {
  return (
    <div className="group">
      <ReferenceVideoNodeInner {...props} />
    </div>
  )
})
