let installed = false

function ensureCareSections() {
  const shell = document.querySelector<HTMLElement>('.site-shell')
  const main = shell?.querySelector<HTMLElement>('main')
  if (!shell || !main) return

  const heroParagraph = shell.querySelector<HTMLElement>('.hero .hero-copy > p')
  if (heroParagraph) {
    heroParagraph.textContent = 'Psicoterapia online em Terapia Cognitivo-Comportamental (TCC), com sessões individuais de 50 minutos, escuta cuidadosa, ética e respeito ao seu tempo.'
  }

  const heroActions = shell.querySelector<HTMLElement>('.hero .hero-actions')
  if (heroActions) {
    const bookingButton = heroActions.querySelector<HTMLButtonElement>('.primary-button')
    bookingButton?.remove()
  }

  shell.querySelector<HTMLElement>('.hero .trust-row')?.remove()

  const services = main.querySelector<HTMLElement>('.services#como-funciona')
  if (services && !document.getElementById('pode-ajudar')) {
    const section = document.createElement('section')
    section.id = 'pode-ajudar'
    section.className = 'patient-needs-section'
    section.innerHTML = `
      <div class="section-title">
        <span class="section-kicker">Quando buscar apoio</span>
        <h2>Talvez a terapia possa ajudar você a lidar com</h2>
        <p>Algumas dificuldades podem ganhar mais clareza quando são acolhidas e compreendidas em um espaço terapêutico.</p>
      </div>
      <div class="patient-needs-grid">
        <article><h3>Ansiedade e preocupações</h3><p>Pensamentos recorrentes, antecipação constante e dificuldade para desacelerar.</p></article>
        <article><h3>Autocobrança e insegurança</h3><p>Exigência excessiva consigo, medo de errar e dificuldade em reconhecer limites.</p></article>
        <article><h3>Sobrecarga emocional</h3><p>Cansaço, irritabilidade, sensação de estar no limite ou dificuldade para organizar o que sente.</p></article>
        <article><h3>Relacionamentos</h3><p>Dificuldades de comunicação, conflitos, limites e padrões que se repetem nas relações.</p></article>
        <article><h3>Mudanças e decisões importantes</h3><p>Momentos de transição, escolhas difíceis e necessidade de compreender melhor prioridades e possibilidades.</p></article>
        <article><h3>Compreensão e regulação das emoções</h3><p>Dificuldade para identificar, expressar ou lidar com emoções intensas no cotidiano.</p></article>
      </div>
    `
    services.insertAdjacentElement('afterend', section)
  }

  const atendimento = main.querySelector<HTMLElement>('.process#atendimento')
  if (atendimento && !document.getElementById('sessao-online')) {
    const section = document.createElement('section')
    section.id = 'sessao-online'
    section.className = 'online-prep-section'
    section.innerHTML = `
      <div class="online-prep-copy">
        <span class="section-kicker">Sua sessão online</span>
        <h2>Como se preparar para o atendimento</h2>
        <p>Alguns cuidados simples ajudam a preservar privacidade, conforto e qualidade durante a videochamada.</p>
      </div>
      <div class="online-prep-grid">
        <article><span>01</span><h3>Escolha um ambiente reservado</h3><p>Procure um local onde você possa conversar com privacidade e sem interrupções sempre que possível.</p></article>
        <article><span>02</span><h3>Verifique sua conexão e dispositivo</h3><p>Antes da sessão, confirme o funcionamento da internet, câmera e microfone do aparelho que será utilizado.</p></article>
        <article><span>03</span><h3>Use fones quando for confortável</h3><p>Fones de ouvido podem ajudar na privacidade e reduzir ruídos durante o atendimento.</p></article>
        <article><span>04</span><h3>Acesse pelo Google Meet</h3><p>O link da videochamada será utilizado para o encontro online no dia e horário combinados.</p></article>
      </div>
    `
    atendimento.insertAdjacentElement('afterend', section)
  }

  const faq = main.querySelector<HTMLElement>('.faq#duvidas')
  let conversation = document.getElementById('vamos-conversar') as HTMLElement | null
  if (faq && !conversation) {
    conversation = document.createElement('section')
    conversation.id = 'vamos-conversar'
    conversation.className = 'conversation-cta'
    conversation.innerHTML = `
      <div class="conversation-cta-inner">
        <span class="section-kicker">Consultório de Psicologia</span>
        <h2>Vamos conversar</h2>
        <p>O primeiro passo para iniciar a psicoterapia é conversar. Vamos encontrar um momento em que possamos nos encontrar e conversar sobre o que está em sua mente.</p>
        <button type="button" class="primary-button large conversation-booking-button">Agendar consulta</button>
      </div>
    `
    faq.insertAdjacentElement('afterend', conversation)
    conversation.querySelector<HTMLButtonElement>('.conversation-booking-button')?.addEventListener('click', () => {
      const headerButton = [...shell.querySelectorAll<HTMLButtonElement>('.site-header button')]
        .find(button => (button.textContent || '').trim() === 'Agendar consulta')
      headerButton?.click()
    })
  }

  const contact = document.getElementById('contato')
  if (conversation && contact && conversation.nextElementSibling !== contact) {
    main.insertBefore(conversation, contact)
  }
}

export function installHomepageCareEnhancer() {
  if (installed) return
  installed = true
  ensureCareSections()
  new MutationObserver(ensureCareSections).observe(document.body, { childList: true, subtree: true })
}
