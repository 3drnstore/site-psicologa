let installed = false

const POLICY = 'Cancelamentos ou pedidos de remarcação devem ser solicitados com pelo menos 24 horas de antecedência.'

function updateFaq() {
  const summaries = [...document.querySelectorAll<HTMLDetailsElement>('.faq details')]
  for (const detail of summaries) {
    const summary = detail.querySelector('summary')
    if (!summary) continue
    const text = (summary.textContent || '').toLowerCase()
    if (!text.includes('cancelar') && !text.includes('remarcar')) continue
    let p = detail.querySelector('p')
    if (!p) {
      p = document.createElement('p')
      detail.appendChild(p)
    }
    p.textContent = `${POLICY} Entre em contato para verificar a disponibilidade de um novo horário.`
  }
}

function addBookingPolicy() {
  if (!document.querySelector('.patient-page')) return
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
  const reserveButton = buttons.find(button => /reservar hor[aá]rio|reservando/i.test((button.textContent || '').trim()))
  if (!reserveButton) return

  const container = reserveButton.parentElement
  if (!container || container.querySelector('.booking-cancellation-policy')) return

  const note = document.createElement('p')
  note.className = 'booking-cancellation-policy'
  note.innerHTML = `<strong>Cancelamento e remarcação:</strong> ${POLICY}`
  container.insertBefore(note, reserveButton)
}

function apply() {
  updateFaq()
  addBookingPolicy()
}

export function installCancellationPolicyEnhancer() {
  if (installed) return
  installed = true
  apply()
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true })
}
