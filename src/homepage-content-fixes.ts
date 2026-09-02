let installed = false
let timer: number | undefined

const faqItems = [
  ['O que é psicoterapia?', 'A psicoterapia é um processo de cuidado psicológico baseado em escuta profissional, reflexão e construção conjunta de estratégias para compreender emoções, pensamentos, comportamentos e dificuldades presentes na vida da pessoa.'],
  ['Como funciona a primeira consulta?', 'A primeira consulta é um momento inicial de acolhimento e compreensão da demanda. A psicóloga conhece a história, as necessidades e os objetivos do paciente e explica como será conduzido o processo terapêutico.'],
  ['Quantas sessões são necessárias?', 'Não existe um número fixo de sessões. A duração do acompanhamento depende das necessidades, objetivos e evolução de cada paciente ao longo do processo terapêutico.'],
  ['Os atendimentos são confidenciais?', 'Sim. O atendimento psicológico é conduzido com respeito ao sigilo profissional e às normas éticas aplicáveis à atuação da psicóloga.'],
  ['O que faço se precisar cancelar ou remarcar uma sessão?', 'Caso seja necessário cancelar ou remarcar, o paciente deve entrar em contato com antecedência para verificar a possibilidade de alteração do horário conforme a disponibilidade da profissional.'],
  ['Quais são as modalidades de atendimento disponíveis?', 'Atualmente os atendimentos são realizados exclusivamente de forma on-line, por videochamada através do Google Meet.'],
  ['Atende crianças e adolescentes?', 'O público atendido será informado conforme a atuação profissional e a disponibilidade da psicóloga.'],
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

  const heroParagraph = shell.querySelector<HTMLElement>('.hero-copy > p')
  if (heroParagraph) {
    heroParagraph.textContent = 'Atendimento psicológico individual com escuta cuidadosa, ética e respeito ao seu tempo. Sessões exclusivamente online, com conforto, privacidade e segurança.'
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
