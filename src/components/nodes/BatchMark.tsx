// 「一括: 対象 / 対象外」の印（2026-11-02 段階 4）。段数や対象外の理由はノードに書かず、App モードの「処理内容」にまとめる
import { useBatchMark } from '../../hooks/useBatchMark'

export function BatchMark({ nodeId }: { nodeId: string }) {
  const mark = useBatchMark(nodeId)
  if (!mark) return null
  return (
    <div className="flex">
      <span className="text-[10px] leading-none px-1.5 py-1 rounded" style={{ background: mark.ok ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)', color: mark.ok ? '#22C55E' : '#F59E0B' }}>
        一括: {mark.ok ? '対象' : '対象外'}
      </span>
    </div>
  )
}
