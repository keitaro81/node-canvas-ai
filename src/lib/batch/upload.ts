// BatchInputNode のアップロード補助: 同時実行数の制限・画像サイズの取得。
export async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return size
  } catch {
    return null
  }
}
