const STORAGE_KEY = 'psicogestao.admin.tab'

const labelToTab = (label: string) => {
  if (label === 'Pacientes') return 'pacientes'
  if (label === 'Configurações') return 'configuracoes'
  if (['Agenda', 'Painel', 'Consultas', 'Pagamentos'].includes(label)) return 'agenda'
  return null
}

const tabToLabel = (tab: string) => tab === 'pacientes' ? 'Pacientes' : tab === 'configuracoes' ? 'Configurações' : 'Agenda'

export function installAdminStateEnhancer() {
  const bind = () => {
    const sidebar = document.querySelector<HTMLElement>('.admin-sidebar')
    if (!sidebar) return

    if (!sidebar.dataset.stateBound) {
      sidebar.dataset.stateBound = '1'
      sidebar.querySelectorAll<HTMLButtonElement>('nav button').forEach(button => {
        button.addEventListener('click', () => {
          const tab = labelToTab((button.textContent || '').trim())
          if (tab) localStorage.setItem(STORAGE_KEY, tab)
        })
      })
    }

    if (!sidebar.dataset.stateRestored) {
      sidebar.dataset.stateRestored = '1'
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const label = tabToLabel(saved)
        const target = [...sidebar.querySelectorAll<HTMLButtonElement>('nav button')].find(b => (b.textContent || '').trim() === label)
        if (target && !target.classList.contains('active')) target.click()
      }
    }
  }

  bind()
  new MutationObserver(bind).observe(document.body, { childList: true, subtree: true })
}
