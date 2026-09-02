let installed = false

function applyAccessibility() {
  const body = document.body
  const main = document.querySelector<HTMLElement>('.site-shell main, .patient-page main, .admin-page main, .auth-page')
  if (!main) return false

  if (!main.id) main.id = 'conteudo-principal'
  main.setAttribute('tabindex', '-1')

  if (!document.querySelector('.skip-link')) {
    const skip = document.createElement('a')
    skip.className = 'skip-link'
    skip.href = `#${main.id}`
    skip.textContent = 'Pular para o conteúdo principal'
    body.prepend(skip)
  }

  const menu = document.querySelector<HTMLButtonElement>('.site-header .menu-button')
  const nav = document.querySelector<HTMLElement>('.site-header .nav')
  if (menu && nav) {
    if (!nav.id) nav.id = 'navegacao-principal'
    menu.setAttribute('aria-controls', nav.id)
    menu.setAttribute('aria-label', 'Abrir ou fechar menu de navegação')
    menu.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false')
  }

  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    if (!button.getAttribute('type')) button.setAttribute('type', 'button')
  })

  document.querySelectorAll<HTMLElement>('[aria-hidden="true"]').forEach(el => {
    if (el.matches('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
      el.setAttribute('tabindex', '-1')
    }
  })

  return true
}

export function installAccessibilitySafe() {
  if (installed) return
  installed = true
  let attempts = 0
  const run = () => {
    attempts += 1
    if (applyAccessibility() || attempts >= 20) return
    window.setTimeout(run, 50)
  }
  run()

  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null
    const menu = target?.closest<HTMLButtonElement>('.site-header .menu-button')
    if (!menu) return
    window.setTimeout(() => {
      const nav = document.querySelector<HTMLElement>('.site-header .nav')
      menu.setAttribute('aria-expanded', nav?.classList.contains('open') ? 'true' : 'false')
    }, 0)
  })
}
