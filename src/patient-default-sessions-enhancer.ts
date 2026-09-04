let initializedForCurrentPortal = false

function reorderPatientMenu() {
  const nav = document.querySelector<HTMLElement>('.patient-sidebar[data-native-safe="1"] nav')
  if (!nav) return false

  const sessions = nav.querySelector<HTMLButtonElement>('[data-patient-tab="consultas"]')
  const agenda = nav.querySelector<HTMLButtonElement>('[data-patient-tab="agenda"]')
  if (!sessions || !agenda) return false

  // Navigation is keyed by data-patient-tab, never by visual position.
  if (nav.firstElementChild !== sessions) nav.insertBefore(sessions, nav.firstElementChild)
  if (sessions.nextElementSibling !== agenda) nav.insertBefore(agenda, sessions.nextElementSibling)
  return true
}

function syncPortalEntry() {
  const patientPage = document.querySelector('.patient-page')
  if (!patientPage) {
    initializedForCurrentPortal = false
    return
  }

  if (!initializedForCurrentPortal) {
    initializedForCurrentPortal = true
    // Every new entry into the patient portal starts on Minhas sessões.
    localStorage.setItem('patientPortalTab', 'consultas')
  }

  reorderPatientMenu()
}

export function installPatientDefaultSessionsEnhancer() {
  syncPortalEntry()

  const root = document.getElementById('root')
  if (root) {
    new MutationObserver(() => {
      window.setTimeout(syncPortalEntry, 0)
      window.setTimeout(reorderPatientMenu, 100)
    }).observe(root, { childList: true, subtree: true })
  }

  // The sidebar is appended to body by the stable patient portal enhancer.
  new MutationObserver(() => reorderPatientMenu()).observe(document.body, { childList: true, subtree: true })
  window.addEventListener('pageshow', syncPortalEntry)
}
