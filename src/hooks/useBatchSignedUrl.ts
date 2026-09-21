import { useEffect, useState } from 'react'
import { signBatchPath } from '../lib/cutout/store'

/** batch バケットのパスを表示用の署名 URL にする（所属チームのみ。未取得/失敗時は null）。 */
export function useBatchSignedUrl(path: string | null | undefined): string | null {
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    signBatchPath(path)
      .then((url) => { if (alive) setSigned({ path, url }) })
      .catch(() => { if (alive) setSigned({ path, url: null }) })
    return () => { alive = false }
  }, [path])
  // path が変わった直後は古い URL を返さない（signed.path で照合）
  return path && signed?.path === path ? signed.url : null
}
