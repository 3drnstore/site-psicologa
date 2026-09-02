let installed = false

function ensureOfflineBanner() {
  let banner = document.getElementById('offline-status-banner') as HTMLElement | null
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'offline-status-banner'
    banner.className = 'offline-status-banner'
    banner.setAttribute('role', 'status')
    banner.setAttribute('aria-live', 'polite')
    banner.textContent = 'Sem conexão com a internet. Alguns recursos ficarão indisponíveis.'
    document.body.appendChild(banner)
  }
  banner.hidden = navigator.onLine
}

export function installAppResilience() {
  if (installed) return
  installed = true

  const syncConnection = () => ensureOfflineBanner()
  window.addEventListener('online', syncConnection)
  window.addEventListener('offline', syncConnection)
  syncConnection()

  window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason)
  })

  window.addEventListener('error', event => {
    if (event.error) console.error('Unhandled window error:', event.error)
  })
}
