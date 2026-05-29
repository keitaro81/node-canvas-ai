const isMobile = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

function showOverlay() {
  if (document.getElementById('__download-overlay__')) return
  const el = document.createElement('div')
  el.id = '__download-overlay__'
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,0.45)',
    'z-index:9999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';')
  el.innerHTML = `
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"
      style="animation:__dl_spin__ 0.8s linear infinite">
      <circle cx="18" cy="18" r="14" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
      <path d="M18 4 A14 14 0 0 1 32 18" stroke="white" stroke-width="3" stroke-linecap="round"/>
    </svg>
    <style>@keyframes __dl_spin__ { to { transform: rotate(360deg); } }</style>
  `
  document.body.appendChild(el)
}

function hideOverlay() {
  document.getElementById('__download-overlay__')?.remove()
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  if (isMobile()) showOverlay()
  try {
    const response = await fetch(url)
    const blob = await response.blob()

    if (isMobile() && navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: blob.type })
      if (navigator.canShare({ files: [file] })) {
        hideOverlay()
        try {
          await navigator.share({ files: [file] })
        } catch (err) {
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
  } finally {
    hideOverlay()
  }
}
