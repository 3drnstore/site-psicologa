let installed = false

const POLICY_TITLE = 'Como funcionam o pagamento, o cancelamento e o reagendamento?'
const POLICY_TEXT = 'O pagamento confirma o horário reservado e deve ser concluído dentro do prazo informado no agendamento. Para reservas avulsas, o pagamento deve ser realizado até 24 horas antes da sessão; para sessões recorrentes, o prazo de pagamento é de até 48 horas antes. Nas sessões recorrentes, o reagendamento pelo paciente pode ser solicitado com pelo menos 24 horas de antecedência, sujeito à disponibilidade. Reservas avulsas confirmadas não possuem reagendamento automático pelo portal, sem prejuízo dos direitos assegurados pela legislação aplicável. Nas contratações realizadas pelo site, serão respeitados os direitos previstos no Código de Defesa do Consumidor, inclusive o direito de arrependimento quando aplicável à situação concreta. Se a sessão for cancelada pela profissional ou não puder ser prestada, o paciente poderá optar por reagendamento ou restituição do valor pago.'

function ensurePolicyFaq() {
  const grid = document.querySelector<HTMLElement>('#duvidas .faq-grid')
  if (!grid) return false
  if ([...grid.querySelectorAll('summary')].some(summary => summary.textContent?.trim() === POLICY_TITLE)) return true

  const details = document.createElement('details')
  const summary = document.createElement('summary')
  const paragraph = document.createElement('p')
  summary.textContent = POLICY_TITLE
  paragraph.textContent = POLICY_TEXT
  details.append(summary, paragraph)

  const cancellation = [...grid.querySelectorAll('details')].find(item =>
    item.querySelector('summary')?.textContent?.includes('cancelar ou remarcar')
  )
  if (cancellation) cancellation.insertAdjacentElement('afterend', details)
  else grid.appendChild(details)
  return true
}

export function installFaqPaymentPolicyEnhancer() {
  if (installed) return
  installed = true
  if (ensurePolicyFaq()) return

  const root = document.getElementById('root')
  if (!root) return
  const observer = new MutationObserver(() => {
    if (ensurePolicyFaq()) observer.disconnect()
  })
  observer.observe(root, { childList: true, subtree: true })
}
