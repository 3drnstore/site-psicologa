let installed = false

function addContactSection() {
  const shell = document.querySelector<HTMLElement>('.site-shell')
  const main = shell?.querySelector<HTMLElement>('main')
  if (!shell || !main || document.getElementById('contato')) return

  const section = document.createElement('section')
  section.id = 'contato'
  section.className = 'contact-section'
  section.innerHTML = `
    <div class="contact-heading">
      <span class="section-kicker">Contato</span>
      <h2>Ficou com alguma dúvida antes de agendar? Envie uma mensagem.</h2>
      <p>Este espaço pode ser usado para esclarecer dúvidas sobre o atendimento, funcionamento das sessões ou processo de agendamento.</p>
    </div>
    <form class="contact-form" id="patient-contact-form">
      <div class="contact-row">
        <label>Nome<input name="name" required maxlength="120" /></label>
        <label>E-mail<input name="email" type="email" required maxlength="160" /></label>
      </div>
      <label>Telefone<input name="phone" required maxlength="30" /></label>
      <label>Mensagem<textarea name="message" rows="5" required maxlength="3000"></textarea></label>
      <div class="contact-actions">
        <button type="submit" class="primary-button">Enviar mensagem</button>
        <span class="contact-status" aria-live="polite"></span>
      </div>
    </form>
  `

  const faq = main.querySelector('.faq#duvidas')
  if (faq) faq.insertAdjacentElement('afterend', section)
  else main.appendChild(section)

  const nav = shell.querySelector('.site-header .nav')
  if (nav && !nav.querySelector('a[href="#contato"]')) {
    const link = document.createElement('a')
    link.href = '#contato'
    link.textContent = 'Contato'
    const patientButton = [...nav.children].find(el => (el.textContent || '').trim() === 'Área do paciente')
    if (patientButton) nav.insertBefore(link, patientButton)
    else nav.appendChild(link)
  }

  const form = section.querySelector<HTMLFormElement>('#patient-contact-form')!
  const status = section.querySelector<HTMLElement>('.contact-status')!
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!

  form.addEventListener('submit', async event => {
    event.preventDefault()
    status.textContent = ''
    button.disabled = true
    button.textContent = 'Enviando...'
    const data = new FormData(form)
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') || ''),
          email: String(data.get('email') || ''),
          phone: String(data.get('phone') || ''),
          message: String(data.get('message') || ''),
        }),
      })
      const payload = await response.json().catch(() => ({})) as any
      if (!response.ok) throw new Error(payload.message || 'Não foi possível enviar a mensagem.')
      form.reset()
      status.textContent = 'Mensagem enviada com sucesso.'
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.'
    } finally {
      button.disabled = false
      button.textContent = 'Enviar mensagem'
    }
  })
}

export function installContactSectionEnhancer() {
  if (installed) return
  installed = true
  const run = () => addContactSection()
  run()
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true })
}
