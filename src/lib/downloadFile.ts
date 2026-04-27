const isMobile = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url)
    const blob = await response.blob()

    if (isMobile() && navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: blob.type })
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
        } catch (err) {
          // ユーザーがシェアシートを閉じた場合は何もしない
          if (!(err instanceof Error && err.name === 'AbortError')) {
            window.open(url, '_blank')
          }
        }
        return
      }
    }

    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank')
  }
}
