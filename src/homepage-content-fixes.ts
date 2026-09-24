let installed = false
let timer: number | undefined

const faqItems = [
  ['O que é psicoterapia?', 'A psicoterapia é um processo de cuidado psicológico baseado em escuta profissional, reflexão e construção conjunta de estratégias para compreender emoções, pensamentos, comportamentos e dificuldades presentes na vida da pessoa.'],
  ['Como funciona a primeira sessão?', 'A primeira sessão é um momento inicial de acolhimento e compreensão da demanda.<br><br>A psicóloga conhece um pouco o paciente, sua história, necessidades e objetivos, e explica como será conduzido o processo terapêutico.'],
  ['Quantas sessões são necessárias?', 'Não existe um número fixo de sessões. A duração do acompanhamento depende das necessidades, objetivos e evolução de cada paciente ao longo do processo terapêutico.'],
  ['Os atendimentos são confidenciais?', 'Sim. O atendimento psicológico é realizado com respeito ao sigilo profissional, conforme estabelecido pelo Código de Ética Profissional do Psicólogo e pelas normas que regulamentam a atuação profissional.<br><br>As informações compartilhadas durante as sessões são tratadas com confidencialidade, respeito e responsabilidade.'],
  ['O que faço se precisar cancelar ou remarcar uma sessão?', 'Caso seja necessário cancelar ou remarcar, o paciente deve entrar em contato com antecedência para verificar a possibilidade de alteração do horário conforme a disponibilidade da profissional.'],
  ['Quais são as modalidades de atendimento disponíveis?', 'Os atendimentos são realizados exclusivamente de forma online, por videochamada através da plataforma Google Meet.'],
  ['O que devo fazer se não me sentir à vontade com o terapeuta?', 'É importante conversar sobre como você está se sentindo durante o processo. A relação terapêutica faz parte do atendimento e pode ser discutida de maneira aberta e respeitosa.'],
  ['Quanto tempo leva para ver resultados?', 'Cada processo é único. Mudanças podem acontecer em ritmos diferentes, de acordo com a demanda, o envolvimento no acompanhamento e as características individuais de cada paciente.'],
  ['Como posso contatá-la para mais informações ou para agendar uma consulta?', 'O agendamento pode ser realizado diretamente pelo site. Para outras informações, utilize os canais de contato disponibilizados pela profissional.']
]

function applyHomepageContentFixes() {
  const shell = document.querySelector<HTMLElement>('.site-shell')
  if (!shell) return

  const navLinks = [...shell.querySelectorAll<HTMLAnchorElement>('.site-header .nav a')]
  navLinks.forEach(link => {
    const label = (link.textContent || '').trim().toLowerCase()
    if (label === 'atendimento') link.setAttribute('href', '#atendimento')
    if (label === 'como funciona') link.setAttribute('href', '#como-funciona')
    if (label === 'dúvidas' || label === 'duvidas') link.setAttribute('href', '#duvidas')
  })

  const heroDescription = shell.querySelector<HTMLElement>('.hero-description')
  if (heroDescription) {
    heroDescription.innerHTML = '<p>Atendimento psicológico individual com ética, acolhimento e respeito.</p><p>Sessões exclusivamente online, com privacidade e segurança.</p>'
  }

  const faq = shell.querySelector<HTMLElement>('.faq#duvidas')
  if (faq) {
    const title = faq.querySelector<HTMLElement>('.section-title')
    if (title) {
      title.innerHTML = '<span class="section-kicker">Dúvidas frequentes</span><h2>Perguntas frequentes</h2><p>Você tem alguma dúvida antes de marcar sua sessão?</p>'
    }

    const grid = faq.querySelector<HTMLElement>('.faq-grid')
    if (grid && grid.dataset.enhanced !== 'true') {
      grid.dataset.enhanced = 'true'
      grid.innerHTML = faqItems.map(([question, answer]) => `
        <details>
          <summary>${question}</summary>
          <p>${answer}</p>
        </details>
      `).join('')
    }
  }
}

export function installHomepageContentFixes() {
  if (installed) return
  installed = true

  const schedule = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      applyHomepageContentFixes()
    }, 70)
  }

  schedule()
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
}
