type PatientTab = 'agenda' | 'consultas' | 'dados' | 'seguranca'

type Slot = {
  id: number
  starts_at: string
  ends_at?: string
  public_status: 'free' | 'occupied' | 'blocked' | string
}

let installed = false
let scheduled: number | undefined
let weekOffset = 0
let selectedSlot: number | null = null
let heldAppointment: number | null = null
let agendaSlots: Slot[] = []
let agendaPix = 0
let agendaCard = 0
let agendaDuration = 50
let agendaHoldMinutes = 15

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] || char))

const money = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format((Number(cents) || 0) / 100)

const mondayOf = (value: Date) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return date
}

const addDays = (date: Date, amount: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dateKey = (value: string) => ymd(new Date(value))
const timeLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
const shortDay = (date: Date) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '')
const monthName = (date: Date) => new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(date)
const titleCase = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value

function weekPeriodLabel(start: Date, end: Date) {
  const startMonth = monthName(start)
  const endMonth = monthName(end)
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()

  if (start.getMonth() === end.getMonth() && startYear === endYear) {
    return `${titleCase(startMonth)} de ${startYear}`
  }
  if (startYear === endYear) {
    return `${titleCase(startMonth)} / ${titleCase(endMonth)} de ${startYear}`
  }
  return `${titleCase(startMonth)} de ${startYear} / ${titleCase(endMonth)} de ${endYear}`
}

const displayName = (name: string) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] || 'Paciente'
  if (parts.length === 2) return parts[0]
  return parts.slice(0, -1).join(' ')
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a solicitação.')
  return data
}

function currentTab(): PatientTab {
  const value = localStorage.getItem('patientPortalTab') as PatientTab | null
  return value && ['agenda', 'consultas', 'dados', 'seguranca'].includes(value) ? value : 'agenda'
}

function host() {
  let element = document.querySelector<HTMLElement>('.patient-stable-view')
  if (!element) {
    element = document.createElement('main')
    element.className = 'patient-stable-view'
    document.body.appendChild(element)
  }
  return element
}

function sidebar() {
  let element = document.querySelector<HTMLElement>('.patient-sidebar[data-native-safe="1"]')
  if (!element) {
    element = document.createElement('aside')
    element.className = 'patient-sidebar'
    element.dataset.nativeSafe = '1'
    element.innerHTML = `
      <div class="patient-sidebar-brand">
        <span>Minha área</span>
        <strong>Portal do paciente</strong>
        <div class="patient-sidebar-welcome"></div>
      </div>
      <nav>
        <button type="button" data-patient-tab="agenda">Agenda</button>
        <button type="button" data-patient-tab="consultas">Minhas consultas</button>
        <button type="button" data-patient-tab="dados">Meus dados</button>
        <button type="button" data-patient-tab="seguranca">Segurança</button>
      </nav>
      <div class="patient-sidebar-bottom">
        <button type="button" class="patient-logout" data-patient-logout>Sair</button>
        <small>Seus dados são privados e protegidos.</small>
      </div>`
    document.body.appendChild(element)
  }
  return element
}

function cleanup() {
  document.querySelector('.patient-stable-view')?.remove()
  document.querySelector('.patient-sidebar[data-native-safe="1"]')?.remove()
  document.documentElement.classList.remove('patient-portal-mounted')
}

function setActive(tab: PatientTab) {
  sidebar().querySelectorAll<HTMLButtonElement>('[data-patient-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.patientTab === tab)
  })
  localStorage.setItem('patientPortalTab', tab)
}

function selectedSlotData() {
  return agendaSlots.find(slot => Number(slot.id) === selectedSlot) || null
}

function bookingMarkup() {
  const slot = selectedSlotData()
  return `
    <div class="patient-booking-info">
      <p><strong>Sessão online com duração de ${agendaDuration} minutos.</strong></p>
      <p>O agendamento será confirmado após a confirmação do pagamento.</p>
      <p>O pagamento deverá ser realizado na próxima etapa.</p>
      <p><strong>Valor da sessão: Pix: ${money(agendaPix)} · Cartão: ${money(agendaCard)}</strong></p>
    </div>
    <div class="patient-booking-choice">
      <small>Horário escolhido</small>
      <strong>${slot ? esc(timeLabel(slot.starts_at)) : 'Selecione um horário'}</strong>
    </div>
    <div class="patient-booking-actions">
      ${heldAppointment
        ? '<button type="button" data-pay="pix">Pagar com Pix</button><button type="button" data-pay="card">Pagar com cartão</button>'
        : `<button type="button" data-reserve ${selectedSlot ? '' : 'disabled'}>Reservar horário</button>`}
    </div>`
}

function bindBookingActions() {
  const h = host()
  h.querySelector<HTMLButtonElement>('[data-reserve]')?.addEventListener('click', async () => {
    if (!selectedSlot) return
    const message = h.querySelector<HTMLElement>('.patient-action-message')
    if (message) message.textContent = 'Reservando horário...'
    try {
      const result = await request('/api/appointments/reserve', {
        method: 'POST',
        body: JSON.stringify({ slot_id: selectedSlot }),
      })
      heldAppointment = Number(result.appointment_id)
      const booking = h.querySelector<HTMLElement>('.patient-booking-box')
      if (booking) booking.innerHTML = bookingMarkup()
      if (message) message.textContent = `Horário reservado por ${agendaHoldMinutes} minutos. Conclua o pagamento.`
      bindBookingActions()
    } catch (error) {
      if (message) message.textContent = error instanceof Error ? error.message : 'Não foi possível reservar.'
    }
  })

  h.querySelectorAll<HTMLButtonElement>('[data-pay]').forEach(button => button.addEventListener('click', async () => {
    if (!heldAppointment) return
    const method = button.dataset.pay as 'pix' | 'card'
    try {
      const result = await request('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({ appointment_id: heldAppointment, method }),
      })
      if (result.checkout_url) window.location.href = result.checkout_url
    } catch (error) {
      const message = h.querySelector<HTMLElement>('.patient-action-message')
      if (message) message.textContent = error instanceof Error ? error.message : 'Não foi possível iniciar o pagamento.'
    }
  }))
}

function selectSlot(slotId: number) {
  selectedSlot = slotId
  heldAppointment = null
  const h = host()
  h.querySelectorAll<HTMLButtonElement>('[data-slot-id]').forEach(button => {
    button.classList.toggle('selected', Number(button.dataset.slotId) === slotId)
  })
  const booking = h.querySelector<HTMLElement>('.patient-booking-box')
  if (booking) booking.innerHTML = bookingMarkup()
  const message = h.querySelector<HTMLElement>('.patient-action-message')
  if (message) message.textContent = ''
  bindBookingActions()
}

async function renderAgenda() {
  const h = host()
  h.innerHTML = '<div class="patient-view-loading">Carregando agenda...</div>'
  try {
    const start = addDays(mondayOf(new Date()), weekOffset * 7)
    const end = addDays(start, 4)
    const data = await request(`/api/availability?from=${encodeURIComponent(ymd(start))}&to=${encodeURIComponent(ymd(end))}`)
    agendaSlots = data.slots || []
    agendaPix = Number(data.pix_price_cents || data.consultation_price_cents || 0)
    agendaCard = Number(data.card_price_cents || data.consultation_price_cents || 0)
    agendaDuration = Math.max(1, Number(data.appointment_duration_minutes || 50))
    agendaHoldMinutes = Math.max(1, Number(data.hold_minutes || 15))
    selectedSlot = null
    heldAppointment = null

    const byDay = new Map<string, Slot[]>()
    agendaSlots.forEach(slot => {
      const key = dateKey(slot.starts_at)
      byDay.set(key, [...(byDay.get(key) || []), slot])
    })
    const days = Array.from({ length: 5 }, (_, index) => addDays(start, index))
    const now = Date.now()

    h.innerHTML = `
      <section class="patient-agenda-head">
        <span>Agendamento</span>
        <h1>Escolha o melhor horário para você</h1>
        <p>Selecione um horário disponível para reservar sua consulta.</p>
        <div class="patient-week-nav">
          <button type="button" data-week-prev ${weekOffset <= 0 ? 'disabled' : ''} aria-label="Semana anterior">‹</button>
          <strong>${esc(weekPeriodLabel(start, end))}</strong>
          <button type="button" data-week-next aria-label="Próxima semana">›</button>
        </div>
      </section>
      <section class="patient-week-grid">
        ${days.map(day => {
          const items = (byDay.get(ymd(day)) || []).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
          return `<article class="patient-week-day">
            <header><strong>${day.getDate()}</strong><span>${esc(shortDay(day))}</span></header>
            <div>${items.length ? items.map(slot => {
              const free = slot.public_status === 'free' && new Date(slot.starts_at).getTime() > now
              return `<button type="button" class="patient-slot ${free ? 'free' : 'occupied'}" data-slot-id="${slot.id}" ${free ? '' : 'disabled'}>
                <span>${esc(timeLabel(slot.starts_at))}</span><small>${free ? 'Disponível' : 'Ocupado'}</small>
              </button>`
            }).join('') : '<p class="patient-no-slots">Sem horários</p>'}</div>
          </article>`
        }).join('')}
      </section>
      <aside class="patient-booking-box">${bookingMarkup()}</aside>
      <div class="patient-action-message" aria-live="polite"></div>`

    h.querySelector<HTMLButtonElement>('[data-week-prev]')?.addEventListener('click', () => {
      if (weekOffset <= 0) return
      weekOffset -= 1
      void renderAgenda()
    })
    h.querySelector<HTMLButtonElement>('[data-week-next]')?.addEventListener('click', () => {
      weekOffset += 1
      void renderAgenda()
    })
    h.querySelectorAll<HTMLButtonElement>('[data-slot-id]').forEach(button => button.addEventListener('click', () => {
      selectSlot(Number(button.dataset.slotId))
    }))
    bindBookingActions()
  } catch (error) {
    h.innerHTML = `<div class="patient-view-error">${esc(error instanceof Error ? error.message : 'Não foi possível carregar a agenda.')}</div>`
  }
}

async function renderConsultas() {
  const h = host()
  h.innerHTML = '<div class="patient-view-loading">Carregando consultas...</div>'
  try {
    const data = await request('/api/appointments/mine')
    const appointments: any[] = data.appointments || []
    const now = Date.now()
    const confirmed = appointments.filter(item => item.status === 'confirmed')
    const future = confirmed.filter(item => new Date(item.ends_at || item.starts_at).getTime() >= now)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    const history = confirmed.filter(item => new Date(item.ends_at || item.starts_at).getTime() < now)
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
    const row = (item: any) => `<article class="patient-consult-row"><div><strong>${esc(dateLabel(item.starts_at))}</strong><span>${esc(timeLabel(item.starts_at))}</span></div><span>Confirmada</span></article>`

    h.innerHTML = `<div class="patient-section-content">
      <h1 class="patient-page-title">Minhas consultas</h1>
      <section class="patient-panel"><div class="patient-panel-head"><strong>Próxima sessão</strong><small>Consultas confirmadas após pagamento</small></div>${future.length ? future.map(row).join('') : '<p class="patient-empty">Você não possui consulta futura confirmada.</p>'}</section>
      <section class="patient-panel"><div class="patient-panel-head"><strong>Histórico</strong><small>Sessões anteriores confirmadas</small></div>${history.length ? history.map(row).join('') : '<p class="patient-empty">Ainda não há sessões anteriores no seu histórico.</p>'}</section>
    </div>`
  } catch (error) {
    h.innerHTML = `<div class="patient-view-error">${esc(error instanceof Error ? error.message : 'Não foi possível carregar suas consultas.')}</div>`
  }
}

async function renderDados() {
  const h = host()
  try {
    const data = await request('/api/me')
    const patient = data.patient || {}
    h.innerHTML = `<div class="patient-section-content">
      <h1 class="patient-page-title">Meus dados</h1>
      <section class="patient-panel">
        <form class="patient-form" data-profile>
          <label>Nome completo<input name="full_name" value="${esc(patient.full_name)}" required></label>
          <label>Data de nascimento<input name="birth_date" type="date" value="${esc(patient.birth_date)}" required></label>
          <label>Telefone<input name="phone" value="${esc(patient.phone)}" required></label>
          <label>E-mail<input value="${esc(patient.email)}" disabled></label>
          <button type="submit">Salvar alterações</button>
          <div class="patient-action-message"></div>
        </form>
      </section>
      <section class="patient-panel patient-danger-zone">
        <h2>Excluir conta</h2>
        <p><strong>A exclusão do seu acesso é irreversível.</strong> Seu cadastro clínico, histórico de atendimentos e prontuário permanecerão preservados para a psicóloga.</p>
        <form class="patient-form" data-delete-account>
          <label>Confirme sua senha de acesso<input name="current_password" type="password" autocomplete="current-password" required></label>
          <button type="submit" class="patient-danger-button">Excluir minha conta</button>
          <div class="patient-action-message"></div>
        </form>
      </section>
    </div>`

    h.querySelector<HTMLFormElement>('[data-profile]')?.addEventListener('submit', async event => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const message = form.querySelector<HTMLElement>('.patient-action-message')!
      try {
        await request('/api/me/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: String(formData.get('full_name') || ''),
            birth_date: String(formData.get('birth_date') || ''),
            phone: String(formData.get('phone') || ''),
          }),
        })
        message.textContent = 'Dados atualizados.'
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Não foi possível atualizar.'
      }
    })

    h.querySelector<HTMLFormElement>('[data-delete-account]')?.addEventListener('submit', async event => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const message = form.querySelector<HTMLElement>('.patient-action-message')!
      const password = String(formData.get('current_password') || '')
      const confirmed = window.confirm('ATENÇÃO: esta ação é irreversível para o seu acesso ao Portal do Paciente. Seu prontuário e registros de atendimento serão preservados para a psicóloga. Deseja realmente excluir sua conta?')
      if (!confirmed) return
      message.textContent = 'Excluindo conta...'
      try {
        await request('/api/me/account', {
          method: 'DELETE',
          body: JSON.stringify({ current_password: password, confirmation: 'EXCLUIR MINHA CONTA' }),
        })
        localStorage.removeItem('patientPortalTab')
        window.location.href = '/?conta-excluida=1'
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Não foi possível excluir a conta.'
      }
    })
  } catch (error) {
    h.innerHTML = `<div class="patient-view-error">${esc(error instanceof Error ? error.message : 'Não foi possível carregar seus dados.')}</div>`
  }
}

async function renderSeguranca() {
  const h = host()
  try {
    const data = await request('/api/me')
    const patient = data.patient || {}
    h.innerHTML = `<div class="patient-section-content">
      <h1 class="patient-page-title">Segurança</h1>
      <div class="patient-security-grid">
        <section class="patient-panel"><h2>Alterar e-mail</h2><form class="patient-form" data-email><label>Novo e-mail<input name="email" type="email" value="${esc(patient.email)}" required></label><label>Senha atual<input name="current_password" type="password" required></label><button type="submit">Alterar e-mail</button><div class="patient-action-message"></div></form></section>
        <section class="patient-panel"><h2>Alterar senha</h2><form class="patient-form" data-password><label>Senha atual<input name="current_password" type="password" required></label><label>Nova senha<input name="new_password" type="password" minlength="10" required></label><label>Confirmar nova senha<input name="confirm_password" type="password" minlength="10" required></label><button type="submit">Alterar senha</button><div class="patient-action-message"></div></form></section>
      </div>
    </div>`

    h.querySelector<HTMLFormElement>('[data-email]')?.addEventListener('submit', async event => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const message = form.querySelector<HTMLElement>('.patient-action-message')!
      try {
        await request('/api/me/email', {
          method: 'PATCH',
          body: JSON.stringify({ email: String(formData.get('email') || ''), current_password: String(formData.get('current_password') || '') }),
        })
        message.textContent = 'E-mail atualizado.'
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Não foi possível alterar o e-mail.'
      }
    })

    h.querySelector<HTMLFormElement>('[data-password]')?.addEventListener('submit', async event => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const message = form.querySelector<HTMLElement>('.patient-action-message')!
      const nextPassword = String(formData.get('new_password') || '')
      const confirmation = String(formData.get('confirm_password') || '')
      if (nextPassword !== confirmation) {
        message.textContent = 'As novas senhas não coincidem.'
        return
      }
      try {
        await request('/api/me/password', {
          method: 'PATCH',
          body: JSON.stringify({ current_password: String(formData.get('current_password') || ''), new_password: nextPassword }),
        })
        message.textContent = 'Senha alterada. Entre novamente com a nova senha.'
        form.reset()
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Não foi possível alterar a senha.'
      }
    })
  } catch (error) {
    h.innerHTML = `<div class="patient-view-error">${esc(error instanceof Error ? error.message : 'Não foi possível carregar Segurança.')}</div>`
  }
}

async function render(tab: PatientTab) {
  if (!document.querySelector('.patient-page')) return
  setActive(tab)
  if (tab === 'agenda') await renderAgenda()
  else if (tab === 'consultas') await renderConsultas()
  else if (tab === 'dados') await renderDados()
  else await renderSeguranca()
}

async function enhance() {
  const page = document.querySelector<HTMLElement>('.patient-page')
  if (!page) {
    cleanup()
    return
  }
  document.documentElement.classList.add('patient-portal-mounted')
  page.classList.add('patient-native-shell')
  const main = page.querySelector<HTMLElement>('.patient-content')
  if (main) main.style.setProperty('display', 'none', 'important')
  sidebar()
  host()
  try {
    const data = await request('/api/me')
    const welcome = document.querySelector<HTMLElement>('.patient-sidebar-welcome')
    if (welcome) welcome.innerHTML = `Bem vindo, <strong>${esc(displayName(data.patient?.full_name || ''))}</strong>`
  } catch {}
  await render(currentTab())
}

export function installPatientPortalEnhancer() {
  if (installed) return
  installed = true

  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null
    const tabButton = target?.closest<HTMLButtonElement>('.patient-sidebar[data-native-safe="1"] [data-patient-tab]')
    if (tabButton) {
      event.preventDefault()
      void render(tabButton.dataset.patientTab as PatientTab)
      return
    }
    const logout = target?.closest<HTMLButtonElement>('[data-patient-logout]')
    if (logout) {
      event.preventDefault()
      logout.disabled = true
      logout.textContent = 'Saindo...'
      void request('/api/auth/logout', { method: 'POST' })
        .catch(() => null)
        .finally(() => {
          localStorage.removeItem('patientPortalTab')
          window.location.href = '/'
        })
    }
  }, true)

  const schedule = () => {
    if (scheduled) clearTimeout(scheduled)
    scheduled = window.setTimeout(() => {
      scheduled = undefined
      void enhance()
    }, 80)
  }

  schedule()
  const root = document.getElementById('root')
  if (root) new MutationObserver(() => schedule()).observe(root, { childList: true, subtree: false })
  window.addEventListener('pageshow', schedule)
}
