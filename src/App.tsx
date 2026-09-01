import { useMemo, useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  CreditCard,
  HeartHandshake,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-react'

type View = 'site' | 'login' | 'cadastro' | 'paciente' | 'admin'

type SlotStatus = 'free' | 'pending' | 'confirmed' | 'blocked'

type Slot = {
  time: string
  status: SlotStatus
  name?: string
}

const week = [
  { day: '16', label: 'Domingo', slots: [] as Slot[] },
  {
    day: '17',
    label: 'Segunda',
    slots: [
      { time: '08:30 – 09:00', status: 'free' },
      { time: '09:15 – 09:45', status: 'free' },
      { time: '10:00 – 10:30', status: 'free' },
      { time: '10:45 – 11:15', status: 'free' },
      { time: '11:30 – 12:00', status: 'blocked' },
      { time: '12:15 – 12:45', status: 'free' },
      { time: '13:00 – 13:30', status: 'free' },
      { time: '13:45 – 14:15', status: 'free' },
    ],
  },
  {
    day: '18',
    label: 'Terça',
    slots: [
      { time: '09:15 – 09:45', status: 'free' },
      { time: '10:00 – 10:30', status: 'confirmed', name: 'Ana Laura Cardoso' },
      { time: '10:45 – 11:15', status: 'free' },
      { time: '11:30 – 12:00', status: 'blocked' },
      { time: '12:15 – 12:45', status: 'free' },
      { time: '13:00 – 13:30', status: 'confirmed', name: 'João Pedro Garcia' },
      { time: '13:45 – 14:15', status: 'free' },
    ],
  },
  {
    day: '19',
    label: 'Quarta',
    slots: [
      { time: '09:15 – 09:45', status: 'free' },
      { time: '10:00 – 10:30', status: 'free' },
      { time: '10:45 – 11:15', status: 'confirmed', name: 'Flávia Caroline' },
      { time: '11:30 – 12:00', status: 'pending', name: 'José Lucas' },
      { time: '12:15 – 12:45', status: 'free' },
    ],
  },
]

const patientSlots = [
  { day: 'Terça, 18 de março', times: ['09:15', '10:45', '12:15', '13:45'] },
  { day: 'Quarta, 19 de março', times: ['09:15', '10:00', '12:15', '14:30'] },
  { day: 'Sexta, 21 de março', times: ['08:30', '09:15', '11:30', '13:00'] },
]

function App() {
  const [view, setView] = useState<View>('site')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState('')
  const consultationPrice = 'R$ 00,00'

  const statusLabel = useMemo(
    () => ({ free: 'Horário livre', pending: 'Aguardando pagamento', confirmed: 'Confirmado', blocked: 'Bloqueado' }),
    [],
  )

  const navigate = (next: View) => {
    setView(next)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (view === 'login' || view === 'cadastro') {
    return <AuthView mode={view} onBack={() => navigate('site')} onSuccess={() => navigate('paciente')} onSwitch={navigate} />
  }

  if (view === 'paciente') {
    return <PatientView price={consultationPrice} selectedSlot={selectedSlot} setSelectedSlot={setSelectedSlot} onBack={() => navigate('site')} />
  }

  if (view === 'admin') {
    return <AdminView week={week} statusLabel={statusLabel} onBack={() => navigate('site')} />
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <button className="brand" onClick={() => navigate('site')} aria-label="Página inicial">
          <span className="brand-mark">ψ</span>
          <span>
            <strong>Nome da Psicóloga</strong>
            <small>Psicologia • CRP 00/00000</small>
          </span>
        </button>
        <nav className={menuOpen ? 'nav open' : 'nav'}>
          <a href="#sobre">Sobre</a>
          <a href="#atendimento">Atendimento</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#duvidas">Dúvidas</a>
          <button className="text-button" onClick={() => navigate('login')}>Área do paciente</button>
          <button className="primary-button" onClick={() => navigate('login')}>Agendar consulta</button>
        </nav>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
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
            <div className="trust-row">
              <span><ShieldCheck size={18} /> Sigilo e ética profissional</span>
              <span><CalendarDays size={18} /> Agendamento online</span>
            </div>
          </div>
          <div className="hero-art" aria-label="Espaço reservado para fotografia profissional">
            <div className="portrait-placeholder">
              <HeartHandshake size={52} />
              <span>Foto profissional</span>
            </div>
            <div className="floating-card">
              <Clock3 size={19} />
              <div><strong>Escolha seu horário</strong><small>Veja a agenda disponível em tempo real</small></div>
            </div>
          </div>
        </section>

        <section className="intro" id="sobre">
          <span className="section-kicker">Sobre a profissional</span>
          <div className="split-heading">
            <h2>Psicoterapia é um encontro com a sua própria história.</h2>
            <div>
              <p>Este espaço será personalizado com a apresentação da psicóloga, sua abordagem, formação e forma de conduzir os atendimentos.</p>
              <p>A proposta visual é transmitir acolhimento, segurança e profissionalismo sem deixar a experiência fria ou excessivamente clínica.</p>
            </div>
          </div>
        </section>

        <section className="services" id="atendimento">
          <div className="section-title">
            <span className="section-kicker">Atendimento</span>
            <h2>Um cuidado pensado para diferentes momentos da vida.</h2>
          </div>
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

        <section className="booking-callout">
          <div><span className="section-kicker">Primeiro passo</span><h2>Quando fizer sentido para você, escolha um horário.</h2><p>O cadastro leva poucos minutos. A reserva só é confirmada após a aprovação do pagamento.</p></div>
          <button className="primary-button large" onClick={() => navigate('login')}>Agendar consulta <ArrowRight size={18} /></button>
        </section>

        <section className="faq" id="duvidas">
          <div className="section-title"><span className="section-kicker">Dúvidas frequentes</span><h2>Antes de começar</h2></div>
          <div className="faq-grid">
            <details open><summary>Como funciona a primeira consulta?</summary><p>A primeira sessão é um momento de acolhimento e compreensão da sua demanda. O formato e a continuidade serão conversados com a profissional.</p></details>
            <details><summary>O atendimento pode ser online?</summary><p>Sim. A disponibilidade de modalidades será configurada pela psicóloga no painel administrativo.</p></details>
            <details><summary>Quando meu horário fica confirmado?</summary><p>O horário fica temporariamente reservado durante o checkout e passa a confirmado assim que o pagamento é aprovado.</p></details>
          </div>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">ψ</span><span><strong>Nome da Psicóloga</strong><small>Psicologia • CRP 00/00000</small></span></div>
        <p>© 2026 • Atendimento psicológico com ética, acolhimento e confidencialidade.</p>
        <button className="admin-link" onClick={() => navigate('admin')}>Acesso profissional</button>
      </footer>
    </div>
  )
}

function AuthView({ mode, onBack, onSuccess, onSwitch }: { mode: 'login' | 'cadastro'; onBack: () => void; onSuccess: () => void; onSwitch: (view: View) => void }) {
  const cadastro = mode === 'cadastro'
  return (
    <div className="auth-page">
      <button className="back-link" onClick={onBack}><ChevronLeft size={18} /> Voltar ao site</button>
      <div className="auth-card">
        <div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>Nome da Psicóloga</strong><small>Área do paciente</small></div></div>
        <span className="section-kicker">{cadastro ? 'Novo paciente' : 'Bem-vindo(a)'}</span>
        <h1>{cadastro ? 'Crie sua conta' : 'Acesse sua conta'}</h1>
        <p>{cadastro ? 'Informe seus dados para acessar a agenda de consultas.' : 'Entre para visualizar horários, pagamentos e consultas.'}</p>
        <button className="google-button" onClick={onSuccess}><span>G</span> Continuar com Google</button>
        <div className="divider"><span>ou</span></div>
        <form onSubmit={(e) => { e.preventDefault(); onSuccess() }}>
          {cadastro && <>
            <label>Nome completo<input required placeholder="Seu nome completo" /></label>
            <div className="form-row"><label>Data de nascimento<input required type="date" /></label><label>CPF<input required placeholder="000.000.000-00" /></label></div>
            <label>Telefone<input required placeholder="(00) 00000-0000" /></label>
          </>}
          <label>E-mail<input required type="email" placeholder="voce@email.com" /></label>
          <label>Senha<input required type="password" placeholder="••••••••" /></label>
          <button className="primary-button full" type="submit">{cadastro ? 'Criar conta' : 'Entrar'}</button>
        </form>
        <p className="auth-switch">{cadastro ? 'Já possui cadastro?' : 'Ainda não possui cadastro?'} <button onClick={() => onSwitch(cadastro ? 'login' : 'cadastro')}>{cadastro ? 'Entrar' : 'Criar conta'}</button></p>
        <small className="privacy-note"><LockKeyhole size={14} /> Seus dados serão tratados conforme a política de privacidade e a LGPD.</small>
      </div>
    </div>
  )
}

function PatientView({ price, selectedSlot, setSelectedSlot, onBack }: { price: string; selectedSlot: string; setSelectedSlot: (s: string) => void; onBack: () => void }) {
  return (
    <div className="patient-page">
      <header className="portal-header"><button className="brand" onClick={onBack}><span className="brand-mark">ψ</span><span><strong>Nome da Psicóloga</strong><small>Área do paciente</small></span></button><div className="portal-user"><CircleUserRound size={21} /><span>Olá, Paciente</span></div></header>
      <main className="patient-content">
        <div className="patient-heading"><div><span className="section-kicker">Agendamento</span><h1>Escolha o melhor horário para você</h1><p>Selecione uma disponibilidade abaixo. O horário será reservado temporariamente durante o pagamento.</p></div><div className="price-card"><small>Valor da consulta</small><strong>{price}</strong><span>Pix com desconto ou cartão</span></div></div>
        <div className="availability-list">
          {patientSlots.map((group) => <section className="availability-day" key={group.day}><h2><CalendarDays size={19} />{group.day}</h2><div className="time-grid">{group.times.map((time) => { const key = `${group.day} • ${time}`; return <button className={selectedSlot === key ? 'time selected' : 'time'} key={time} onClick={() => setSelectedSlot(key)}><Clock3 size={16} />{time}{selectedSlot === key && <Check size={16} />}</button> })}</div></section>)}
        </div>
        <aside className="booking-summary"><div><small>Horário escolhido</small><strong>{selectedSlot || 'Selecione um horário'}</strong></div><div><small>Consulta</small><strong>{price}</strong></div><button className="primary-button" disabled={!selectedSlot}>Ir para pagamento <CreditCard size={17} /></button></aside>
      </main>
    </div>
  )
}

function AdminView({ week, statusLabel, onBack }: { week: { day: string; label: string; slots: Slot[] }[]; statusLabel: Record<SlotStatus, string>; onBack: () => void }) {
  const items = [
    [LayoutDashboard, 'Painel'], [Users, 'Pacientes'], [CalendarDays, 'Agenda'], [HeartHandshake, 'Consultas'], [WalletCards, 'Pagamentos'], [MessageCircle, 'Mensagens'], [Settings, 'Configurações'],
  ] as const
  return (
    <div className="admin-page">
      <aside className="admin-sidebar">
        <div className="admin-logo"><span className="brand-mark">ψ</span><span><strong>PsicoGestão</strong><small>Painel profissional</small></span></div>
        <nav>{items.map(([Icon, label]) => <button key={label} className={label === 'Agenda' ? 'active' : ''}><Icon size={17} />{label}</button>)}</nav>
        <button className="logout" onClick={onBack}><LogOut size={17} /> Sair</button>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar"><div><span className="section-kicker">Gestão profissional</span><h1>Agenda</h1></div><button className="admin-primary">+ Novo agendamento</button></header>
        <section className="calendar-toolbar"><button><ChevronLeft size={18} /></button><div><strong>Março de 2026</strong><small>Dias 16 a 22</small></div><button><ChevronRight size={18} /></button></section>
        <section className="calendar-grid">
          {week.map((col) => <div className="calendar-column" key={col.day}><div className="calendar-day"><strong>{col.day}</strong><span>{col.label}</span></div><div className="slot-stack">{col.slots.map((slot, i) => <article className={`slot ${slot.status}`} key={`${slot.time}-${i}`}><strong>{slot.time}</strong><span>{slot.name || statusLabel[slot.status]}</span>{slot.name && <small>{statusLabel[slot.status]}</small>}</article>)}</div></div>)}
        </section>
        <div className="legend"><span><i className="free" />Livre</span><span><i className="pending" />Aguardando pagamento</span><span><i className="confirmed" />Confirmado</span><span><i className="blocked" />Bloqueado</span></div>
      </main>
    </div>
  )
}

export default App
