let installed = false

function applyHomepageCta() {
  const shell = document.querySelector<HTMLElement>('.site-shell')
  const main = shell?.querySelector<HTMLElement>('main')
  if (!shell || !main) return false

  const heroActions = shell.querySelector<HTMLElement>('.hero .hero-actions')
  heroActions?.querySelector<HTMLButtonElement>('.primary-button')?.remove()
  const therapyLink = heroActions?.querySelector<HTMLAnchorElement>('.secondary-button')
  if (therapyLink) {
    therapyLink.textContent = 'Como funciona a terapia'
    therapyLink.href = '#como-funciona'
  }
  shell.querySelector<HTMLElement>('.hero .trust-row')?.remove()

  const faq = main.querySelector<HTMLElement>('.faq#duvidas')
  const contact = document.getElementById('contato')
  if (!faq) return false

  let section = document.getElementById('vamos-conversar') as HTMLElement | null
  if (!section) {
    section = document.createElement('section')
    section.id = 'vamos-conversar'
    section.className = 'conversation-cta'
    section.innerHTML = `
      <div class="conversation-cta-inner">
        <h2>Vamos conversar</h2>
        <p>O primeiro passo para iniciar a psicoterapia é conversar. Vamos encontrar um momento em que possamos nos encontrar e conversar sobre o que está em sua mente.</p>
        <button type="button" class="primary-button large conversation-booking-button">Agendar sessão</button>
      </div>
    `
    if (contact) main.insertBefore(section, contact)
    else faq.insertAdjacentElement('afterend', section)
  }

  const bookingButton = section.querySelector<HTMLButtonElement>('.conversation-booking-button')
  if (bookingButton && bookingButton.dataset.bound !== '1') {
    bookingButton.dataset.bound = '1'
    bookingButton.addEventListener('click', () => {
      const headerButton = [...shell.querySelectorAll<HTMLButtonElement>('.site-header button')]
        .find(button => /^Agendar\s+(consulta|sessão)$/i.test((button.textContent || '').trim()))
      if (headerButton) {
        headerButton.click()
        return
      }
      const patientButton = [...shell.querySelectorAll<HTMLButtonElement>('.site-header button')]
        .find(button => (button.textContent || '').trim() === 'Área do paciente')
      patientButton?.click()
    })
  }

  if (contact && section.nextElementSibling !== contact) main.insertBefore(section, contact)
  return true
}

export function installHomepageCtaSafe() {
  if (installed) return
  installed = true
  let attempts = 0
  const tryApply = () => {
    attempts += 1
    if (applyHomepageCta() || attempts >= 20) return
    window.setTimeout(tryApply, 50)
  }
  tryApply()
}
