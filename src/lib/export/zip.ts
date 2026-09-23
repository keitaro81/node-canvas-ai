// ZIP 作成（fflate）。画像は再圧縮しても縮まないので「格納」（level 0）にして速くする。
import { zipSync, type Zippable } from 'fflate'

export function buildZip(files: Array<{ path: string; data: Uint8Array }>): Blob {
  const tree: Zippable = {}
  for (const f of files) tree[f.path] = [f.data, { level: 0 }]
  const out = zipSync(tree)
  return new Blob([out as BlobPart], { type: 'application/zip' })
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
