// 逐次書き込みの ZIP（fflate の Zip/ZipPassThrough）。画像は再圧縮しても縮まないので「格納」。
// 150 ファイル分を一度に配列で持たず、書き込みながら出力チャンクだけを溜める。
import { Zip, ZipPassThrough } from 'fflate'

export class ZipWriter {
  private chunks: Uint8Array[] = []
  private zip: Zip
  private failed: Error | null = null
  private bytes = 0
  constructor() {
    this.zip = new Zip((err, data) => {
      if (err) { this.failed = err; return }
      this.chunks.push(data)
      this.bytes += data.length
    })
  }
  get size(): number { return this.bytes }
  add(path: string, data: Uint8Array): void {
    if (this.failed) throw this.failed
    const f = new ZipPassThrough(path)
    this.zip.add(f)
    f.push(data, true)
  }
  finish(): Blob {
    this.zip.end()
    if (this.failed) throw this.failed
    return new Blob(this.chunks as BlobPart[], { type: 'application/zip' })
  }
}
