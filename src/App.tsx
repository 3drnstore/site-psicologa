import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, CalendarDays, Check, ChevronLeft, CircleUserRound, Clock3, CreditCard,
  HeartHandshake, LayoutDashboard, LockKeyhole, LogOut, Menu, MessageCircle, Settings,
  ShieldCheck, Sparkles, Users, WalletCards, X,
} from 'lucide-react'
import { api } from './api-client'

type View = 'site' | 'login' | 'cadastro' | 'paciente' | 'admin-login' | 'admin'
type AdminTab = 'agenda' | 'pacientes' | 'configuracoes'
type GooglePending = { email: string; name: string; sub: string } | null

type Slot = { id: number; starts_at: string; ends_at: string }

const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100)
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

function App() {
  const params = new URLSearchParams(window.location.search)
  const googlePending: GooglePending = params.get('google-profile-required') === '1'
    ? { email: params.get('email') || '', name: params.get('name') || '', sub: params.get('sub') || '' }
    : null
  const [view, setView] = useState<View>(googlePending ? 'cadastro' : 'site')
  const [menuOpen, setMenuOpen] = useState(false)

  const navigate = (next: View) => {
    setView(next)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (view === 'login' || view === 'cadastro') {
    return <AuthView mode={view} googlePending={googlePending} onBack={() => navigate('site')} onSuccess={() => navigate('paciente')} onSwitch={navigate} />
  }
  if (view === 'paciente') return <PatientView onBack={() => navigate('site')} />
  if (view === 'admin-login') return <AdminLogin onBack={() => navigate('site')} onSuccess={() => navigate('admin')} />
  if (view === 'admin') return <AdminView onBack={() => navigate('site')} />

  return (
    <div className="site-shell">
      <header className="site-header">
        <button className="brand" onClick={() => navigate('site')} aria-label="Página inicial">
          <span className="brand-mark">ψ</span><span><strong>Nome da Psicóloga</strong><small>Psicologia • CRP 00/00000</small></span>
        </button>
        <nav className={menuOpen ? 'nav open' : 'nav'}>
          <a href="#sobre">Sobre</a><a href="#atendimento">Atendimento</a><a href="#como-funciona">Como funciona</a><a href="#duvidas">Dúvidas</a>
          <button className="text-button" onClick={() => navigate('login')}>Área do paciente</button>
          <button className="primary-button" onClick={() => navigate('login')}>Agendar consulta</button>
        </nav>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><Sparkles size={16} /> Psicoterapia com acolhimento e presença</span>
            <h1>Um espaço seguro para compreender o que você sente e construir novos caminhos.</h1>
            <p>Atendimento psicológico individual com escuta cuidadosa, ética e respeito ao seu tempo. Consultas online e presenciais, conforme disponibilidade.</p>
            <div className="hero-actions">
              <button className="primary-button large" onClick={() => navigate('login')}>Agendar consulta <ArrowRight size={18} /></button>
              <a className="secondary-button" href="#sobre">Conheça o trabalho</a>
            </div>
            <div className="trust-row"><span><ShieldCheck size={18} /> Sigilo e ética profissional</span><span><CalendarDays size={18} /> Agendamento online</span></div>
          </div>
          <div className="hero-art" aria-label="Espaço reservado para fotografia profissional">
            <div className="portrait-placeholder"><HeartHandshake size={52} /><span>Foto profissional</span></div>
            <div className="floating-card"><Clock3 size={19} /><div><strong>Escolha seu horário</strong><small>Veja a agenda disponível em tempo real</small></div></div>
          </div>
        </section>

        <section className="intro" id="sobre">
          <span className="section-kicker">Sobre a profissional</span>
          <div className="split-heading"><h2>Psicoterapia é um encontro com a sua própria história.</h2><div><p>Este espaço será personalizado com a apresentação da psicóloga, sua abordagem, formação e forma de conduzir os atendimentos.</p><p>A proposta visual é transmitir acolhimento, segurança e profissionalismo sem deixar a experiência fria ou excessivamente clínica.</p></div></div>
        </section>

        <section className="services" id="atendimento">
          <div className="section-title"><span className="section-kicker">Atendimento</span><h2>Um cuidado pensado para diferentes momentos da vida.</h2></div>
          <div className="service-grid">
            <article><span>01</span><h3>Psicoterapia individual</h3><p>Um espaço de escuta para compreender emoções, relações, escolhas e padrões que atravessam sua vida.</p></article>
            <article><span>02</span><h3>Atendimento online</h3><p>Consultas por videochamada com praticidade, privacidade e a mesma atenção do atendimento presencial.</p></article>
            <article><span>03</span><h3>Acompanhamento contínuo</h3><p>Uma construção terapêutica respeitando seu ritmo, objetivos e singularidade.</p></article>
          </div>
        </section>

        <section className="process" id="como-funciona">
          <div className="section-title light"><span className="section-kicker">Como funciona</span><h2>Agendar será simples, claro e seguro.</h2></div>
          <div className="steps">
            <div><strong>1</strong><h3>Crie sua conta</h3><p>Cadastre-se com e-mail e senha ou use sua conta Google.</p></div>
            <div><strong>2</strong><h3>Escolha o horário</h3><p>Veja apenas os dias e horários realmente disponíveis na agenda.</p></div>
            <div><strong>3</strong><h3>Faça o pagamento</h3><p>Escolha Pix com desconto ou cartão de crédito no checkout seguro.</p></div>
            <div><strong>4</strong><h3>Receba a confirmação</h3><p>Após o pagamento, a consulta é confirmada e adicionada à agenda da profissional.</p></div>
          </div>
        </section>

        <section className="booking-callout"><div><span className="section-kicker">Primeiro passo</span><h2>Quando fizer sentido para você, escolha um horário.</h2><p>O cadastro leva poucos minutos. A reserva só é confirmada após a aprovação do pagamento.</p></div><button className="primary-button large" onClick={() => navigate('login')}>Agendar consulta <ArrowRight size={18} /></button></section>

        <section className="faq" id="duvidas">
          <div className="section-title"><span className="section-kicker">Dúvidas frequentes</span><h2>Antes de começar</h2></div>
          <div className="faq-grid">
            <details open><summary>Como funciona a primeira consulta?</summary><p>A primeira sessão é um momento de acolhimento e compreensão da sua demanda. O formato e a continuidade serão conversados com a profissional.</p></details>
            <details><summary>O atendimento pode ser online?</summary><p>Sim. A disponibilidade de modalidades será configurada pela psicóloga no painel administrativo.</p></details>
            <details><summary>Quando meu horário fica confirmado?</summary><p>O horário fica temporariamente reservado durante o checkout e passa a confirmado assim que o pagamento é aprovado.</p></details>
          </div>
        </section>
      </main>
      <footer><div className="brand footer-brand"><span className="brand-mark">ψ</span><span><strong>Nome da Psicóloga</strong><small>Psicologia • CRP 00/00000</small></span></div><p>© 2026 • Atendimento psicológico com ética, acolhimento e confidencialidade.</p><button className="admin-link" onClick={() => navigate('admin-login')}>Acesso profissional</button></footer>
    </div>
  )
}

function AuthView({ mode, googlePending, onBack, onSuccess, onSwitch }: { mode: 'login' | 'cadastro'; googlePending: GooglePending; onBack: () => void; onSuccess: () => void; onSwitch: (view: View) => void }) {
  const cadastro = mode === 'cadastro'
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setLoading(true)
    const fd = new FormData(e.currentTarget)
    try {
      if (cadastro) {
        const payload = {
          full_name: String(fd.get('full_name') || ''), birth_date: String(fd.get('birth_date') || ''), cpf: String(fd.get('cpf') || ''),
          phone: String(fd.get('phone') || ''), email: String(fd.get('email') || ''), password: String(fd.get('password') || ''),
          google_sub: googlePending?.sub || '',
        }
        if (googlePending) await api.completeGoogle(payload); else await api.register(payload)
      } else await api.login(String(fd.get('email') || ''), String(fd.get('password') || ''))
      onSuccess()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível entrar.') } finally { setLoading(false) }
  }

  return <div className="auth-page">
    <button className="back-link" onClick={onBack}><ChevronLeft size={18} /> Voltar ao site</button>
    <div className="auth-card">
      <div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>Nome da Psicóloga</strong><small>Área do paciente</small></div></div>
      <span className="section-kicker">{cadastro ? 'Novo paciente' : 'Bem-vindo(a)'}</span><h1>{cadastro ? 'Crie sua conta' : 'Acesse sua conta'}</h1>
      <p>{googlePending ? 'Complete seus dados obrigatórios para finalizar o cadastro com Google.' : cadastro ? 'Informe seus dados para acessar a agenda de consultas.' : 'Entre para visualizar horários, pagamentos e consultas.'}</p>
      {!googlePending && <button className="google-button" onClick={() => { window.location.href = '/api/auth/google/start' }}><span>G</span> Continuar com Google</button>}
      {!googlePending && <div className="divider"><span>ou</span></div>}
      {error && <div className="error-box">{error}</div>}
      <form onSubmit={submit}>
        {cadastro && <><label>Nome completo<input name="full_name" required defaultValue={googlePending?.name || ''} placeholder="Seu nome completo" /></label><div className="form-row"><label>Data de nascimento<input name="birth_date" required type="date" /></label><label>CPF<input name="cpf" required placeholder="000.000.000-00" /></label></div><label>Telefone<input name="phone" required placeholder="(00) 00000-0000" /></label></>}
        <label>E-mail<input name="email" required type="email" defaultValue={googlePending?.email || ''} readOnly={Boolean(googlePending)} placeholder="voce@email.com" /></label>
        {!googlePending && <label>Senha<input name="password" required type="password" minLength={8} placeholder="••••••••" /></label>}
        <button className="primary-button full" disabled={loading} type="submit">{loading ? 'Aguarde...' : cadastro ? 'Criar conta' : 'Entrar'}</button>
      </form>
      {!googlePending && <p className="auth-switch">{cadastro ? 'Já possui cadastro?' : 'Ainda não possui cadastro?'} <button onClick={() => onSwitch(cadastro ? 'login' : 'cadastro')}>{cadastro ? 'Entrar' : 'Criar conta'}</button></p>}
      <small className="privacy-note"><LockKeyhole size={14} /> Seus dados serão tratados conforme a política de privacidade e a LGPD.</small>
    </div>
  </div>
}

function PatientView({ onBack }: { onBack: () => void }) {
  const [patient, setPatient] = useState<any>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [appointments, setAppointments] = useState<any[]>([])
  const [price, setPrice] = useState(0)
  const [pixDiscount, setPixDiscount] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [pendingAppointment, setPendingAppointment] = useState<number | null>(null)
  const [message, setMessage] = useState('')

  async function load() {
    try {
      const [me, av, ap] = await Promise.all([api.me(), api.availability(), api.myAppointments()])
      setPatient(me.patient); setSlots(av.slots || []); setPrice(Number(av.consultation_price_cents || 0)); setPixDiscount(Number(av.pix_discount_percent || 0)); setAppointments(ap.appointments || [])
    } catch { onBack() }
  }
  useEffect(() => { load() }, [])

  const groups = useMemo(() => {
    const map = new Map<string, Slot[]>()
    slots.forEach((slot) => { const key = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(slot.starts_at)); map.set(key, [...(map.get(key) || []), slot]) })
    return [...map.entries()]
  }, [slots])

  async function reserve() {
    if (!selected) return
    try { const result = await api.reserve(selected); setPendingAppointment(result.appointment_id); setMessage('Horário reservado temporariamente. Escolha a forma de pagamento.'); await load() }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Não foi possível reservar.') }
  }

  async function pay(method: 'pix' | 'card') {
    if (!pendingAppointment) return
    try {
      const result = await api.checkout(pendingAppointment, method)
      if (result.checkout_url) window.location.href = result.checkout_url
      else if (result.pix_copy_paste) setMessage(`Pix gerado: ${result.pix_copy_paste}`)
      else setMessage('Pagamento iniciado. Aguarde a confirmação.')
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Não foi possível iniciar o pagamento.') }
  }

  return <div className="patient-page">
    <header className="portal-header"><button className="brand" onClick={onBack}><span className="brand-mark">ψ</span><span><strong>Nome da Psicóloga</strong><small>Área do paciente</small></span></button><div className="portal-user"><CircleUserRound size={21} /><span>{patient?.full_name || 'Paciente'}</span><button className="text-button" onClick={async () => { await api.logout(); onBack() }}>Sair</button></div></header>
    <main className="patient-content">
      <div className="patient-heading"><div><span className="section-kicker">Agendamento</span><h1>Escolha o melhor horário para você</h1><p>O horário fica reservado por alguns minutos enquanto você realiza o pagamento.</p></div><div className="price-card"><small>Valor da consulta</small><strong>{money(price)}</strong><span>{pixDiscount > 0 ? `Pix com ${pixDiscount}% de desconto` : 'Pix ou cartão'}</span></div></div>
      {message && <div className="info-box">{message}</div>}
      <div className="availability-list">
        {groups.length === 0 && <div className="empty-state">Ainda não há horários livres cadastrados pela profissional.</div>}
        {groups.map(([day, items]) => <section className="availability-day" key={day}><h2><CalendarDays size={19} />{day}</h2><div className="time-grid">{items.map((slot) => <button className={selected === slot.id ? 'time selected' : 'time'} key={slot.id} onClick={() => setSelected(slot.id)}><Clock3 size={16} />{new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(slot.starts_at))}{selected === slot.id && <Check size={16} />}</button>)}</div></section>)}
      </div>
      <aside className="booking-summary"><div><small>Horário escolhido</small><strong>{selected ? dateTime(slots.find((s) => s.id === selected)?.starts_at || '') : 'Selecione um horário'}</strong></div><div><small>Consulta</small><strong>{money(price)}</strong></div>{pendingAppointment ? <div className="payment-actions"><button className="primary-button" onClick={() => pay('pix')}>Pagar com Pix</button><button className="secondary-button" onClick={() => pay('card')}>Cartão</button></div> : <button className="primary-button" disabled={!selected} onClick={reserve}>Reservar horário <CreditCard size={17} /></button>}</aside>
      <section className="my-appointments"><h2>Minhas consultas</h2>{appointments.length === 0 ? <p className="empty-state">Nenhuma consulta cadastrada.</p> : appointments.map((a) => <div className="appointment-row" key={a.id}><div><strong>{dateTime(a.starts_at)}</strong><small>{a.status === 'confirmed' ? 'Confirmada' : a.status === 'pending_payment' ? 'Aguardando pagamento' : a.status}</small></div><span>{money(a.amount_cents)}</span></div>)}</section>
    </main>
  </div>
}

function AdminLogin({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget)
    try { await api.adminLogin(String(fd.get('email') || ''), String(fd.get('password') || '')); onSuccess() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível entrar.') }
  }
  return <div className="auth-page"><button className="back-link" onClick={onBack}><ChevronLeft size={18} /> Voltar ao site</button><div className="auth-card"><div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>PsicoGestão</strong><small>Acesso profissional</small></div></div><span className="section-kicker">Área restrita</span><h1>Painel profissional</h1><p>Somente a psicóloga e usuários administrativos autorizados podem acessar prontuários e anotações clínicas.</p>{error && <div className="error-box">{error}</div>}<form onSubmit={submit}><label>E-mail<input name="email" type="email" required /></label><label>Senha<input name="password" type="password" required /></label><button className="primary-button full">Entrar</button></form></div></div>
}

function AdminView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<AdminTab>('agenda')
  const [admin, setAdmin] = useState<any>(null)
  const [appointments, setAppointments] = useState<any[]>([])
  const [patients, setPatients] = useState<any[]>([])
  const [settings, setSettings] = useState<any>({})
  const [selectedPatient, setSelectedPatient] = useState<any>(null)
  const [patientDetail, setPatientDetail] = useState<any>(null)
  const [message, setMessage] = useState('')

  async function load() {
    try {
      const [me, ap, ps, st] = await Promise.all([api.adminMe(), api.adminAppointments(), api.adminPatients(), api.settings()])
      setAdmin(me.admin); setAppointments(ap.appointments || []); setPatients(ps.patients || []); setSettings(st.settings || {})
    } catch { onBack() }
  }
  useEffect(() => { load() }, [])

  async function openPatient(id: number) { setSelectedPatient(id); setPatientDetail(await api.adminPatient(id)) }
  async function addNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!selectedPatient) return
    const fd = new FormData(e.currentTarget)
    try { await api.saveClinicalNote(selectedPatient, { session_date: String(fd.get('session_date') || ''), note_text: String(fd.get('note_text') || '') }); setPatientDetail(await api.adminPatient(selectedPatient)); e.currentTarget.reset(); setMessage('Anotação clínica salva.') }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Não foi possível salvar.') }
  }
  async function addSlot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget)
    try { await api.createSlot({ starts_at: new Date(String(fd.get('starts_at'))).toISOString(), ends_at: new Date(String(fd.get('ends_at'))).toISOString() }); setMessage('Horário criado.'); e.currentTarget.reset(); await load() }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Não foi possível criar o horário.') }
  }
  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget)
    try { await api.updateSettings({ consultation_price_cents: Math.round(Number(fd.get('price') || 0) * 100), pix_discount_percent: Number(fd.get('pix_discount') || 0), hold_minutes: Number(fd.get('hold_minutes') || 15), appointment_duration_minutes: Number(fd.get('duration') || 50) }); setMessage('Configurações salvas.'); await load() }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Não foi possível salvar.') }
  }

  const items: [any, string, AdminTab | null][] = [[LayoutDashboard, 'Painel', 'agenda'], [Users, 'Pacientes', 'pacientes'], [CalendarDays, 'Agenda', 'agenda'], [HeartHandshake, 'Consultas', 'agenda'], [WalletCards, 'Pagamentos', 'agenda'], [MessageCircle, 'Mensagens', null], [Settings, 'Configurações', 'configuracoes']]
  return <div className="admin-page">
    <aside className="admin-sidebar"><div className="admin-logo"><span className="brand-mark">ψ</span><span><strong>PsicoGestão</strong><small>Painel profissional</small></span></div><nav>{items.map(([Icon, label, target]) => <button key={label} className={target === tab ? 'active' : ''} disabled={!target} onClick={() => target && setTab(target)}><Icon size={17} />{label}</button>)}</nav><button className="logout" onClick={async () => { await api.adminLogout(); onBack() }}><LogOut size={17} /> Sair</button></aside>
    <main className="admin-main"><header className="admin-topbar"><div><span className="section-kicker">Gestão profissional</span><h1>{tab === 'pacientes' ? 'Pacientes e prontuários' : tab === 'configuracoes' ? 'Configurações' : 'Agenda'}</h1></div><span className="admin-welcome">{admin?.display_name}</span></header>{message && <div className="info-box">{message}</div>}
      {tab === 'agenda' && <><section className="admin-panel"><div className="admin-section-head"><div><h2>Novo horário disponível</h2><p>O paciente verá somente horários livres.</p></div></div><form className="inline-form" onSubmit={addSlot}><label>Início<input name="starts_at" type="datetime-local" required /></label><label>Fim<input name="ends_at" type="datetime-local" required /></label><button className="admin-primary">Adicionar</button></form></section><section className="admin-panel"><div className="admin-section-head"><h2>Consultas</h2><span>{appointments.length} registros</span></div><div className="appointment-list">{appointments.length === 0 ? <p className="empty-state">Nenhuma consulta ainda.</p> : appointments.map((a) => <article className="admin-appointment" key={a.id}><div><strong>{dateTime(a.starts_at)}</strong><span>{a.full_name}</span><small>{a.email} • {a.phone}</small></div><span className={`status-pill ${a.status}`}>{a.status === 'confirmed' ? 'Confirmada' : a.status === 'pending_payment' ? 'Aguardando pagamento' : a.status}</span></article>)}</div></section></>}
      {tab === 'pacientes' && <div className="admin-content-grid"><section className="admin-panel patient-list"><div className="admin-section-head"><h2>Banco de pacientes</h2><span>{patients.length}</span></div>{patients.map((p) => <button className={selectedPatient === p.id ? 'patient-card active' : 'patient-card'} key={p.id} onClick={() => openPatient(p.id)}><strong>{p.full_name}</strong><span>{p.email}</span><small>{p.phone} • {p.appointment_count} atendimento(s)</small></button>)}</section><section className="admin-panel record-panel">{!patientDetail ? <div className="empty-state">Selecione um paciente para abrir o prontuário.</div> : <><div className="record-head"><div><span className="section-kicker">Prontuário privado</span><h2>{patientDetail.patient.full_name}</h2><p>{patientDetail.patient.email} • {patientDetail.patient.phone}<br />Nascimento: {patientDetail.patient.birth_date} • CPF: {patientDetail.patient.cpf}</p></div><LockKeyhole size={22} /></div><div className="record-warning">Estas anotações são exclusivas da área profissional. O paciente não possui endpoint ou tela para acessá-las.</div><form className="admin-form" onSubmit={addNote}><label>Data da sessão<input name="session_date" type="date" required /></label><label>Observações clínicas<textarea name="note_text" required rows={6} placeholder="Registro da sessão, evolução, condutas e observações relevantes..." /></label><button className="admin-primary">Salvar anotação</button></form><div className="note-list"><h3>Histórico de anotações</h3>{patientDetail.clinical_notes.length === 0 ? <p className="empty-state">Nenhuma anotação registrada.</p> : patientDetail.clinical_notes.map((n: any) => <article key={n.id}><strong>{new Intl.DateTimeFormat('pt-BR').format(new Date(`${n.session_date}T12:00:00`))}</strong><p>{n.note_text}</p><small>Registrado em {dateTime(n.created_at)}</small></article>)}</div></>}</section></div>}
      {tab === 'configuracoes' && <section className="admin-panel settings-panel"><h2>Atendimento e cobrança</h2><form className="admin-form" onSubmit={saveSettings}><label>Valor da consulta (R$)<input name="price" type="number" min="0" step="0.01" defaultValue={Number(settings.consultation_price_cents || 0) / 100} /></label><label>Desconto no Pix (%)<input name="pix_discount" type="number" min="0" max="100" step="0.1" defaultValue={settings.pix_discount_percent || 0} /></label><label>Duração padrão (minutos)<input name="duration" type="number" min="10" defaultValue={settings.appointment_duration_minutes || 50} /></label><label>Tempo de reserva aguardando pagamento (minutos)<input name="hold_minutes" type="number" min="5" defaultValue={settings.hold_minutes || 15} /></label><button className="admin-primary">Salvar configurações</button></form></section>}
    </main>
  </div>
}

export default App
