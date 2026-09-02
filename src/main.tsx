import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminSetup from './AdminSetup'
import PasswordRecovery from './PasswordRecovery'
import { installPasswordEnhancer } from './password-enhancer'
import { installAdminCalendarEnhancer } from './admin-calendar-enhancer'
import { installAdminStateEnhancer } from './admin-state-enhancer'
import { installPatientCalendarEnhancer } from './patient-calendar-enhancer'
import { installPatientPortalEnhancer } from './patient-portal-enhancer'
import { installPatientWelcomeEnhancer } from './patient-welcome-enhancer'
import { installAdminAppointmentEnhancer } from './admin-appointment-enhancer'
import { installPricingUiEnhancer } from './pricing-ui-enhancer'
import './styles.css'
import './app-extra.css'
import './v2.css'
import './admin-calendar.css'
import './patient-calendar.css'
import './patient-portal.css'

const path = window.location.pathname

function AdminRouteGate() {
  const [state, setState] = useState<'checking' | 'authenticated' | 'anonymous'>('checking')

  useEffect(() => {
    fetch('/api/admin/me', { credentials: 'include' })
      .then(response => setState(response.ok ? 'authenticated' : 'anonymous'))
      .catch(() => setState('anonymous'))
  }, [])

  if (state === 'checking') {
    return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>PsicoGestão</strong><small>Painel profissional</small></div></div><h1>Carregando...</h1><p>Restaurando sua sessão e a tela em que você estava.</p></div></div>
  }

  return <App initialView={state === 'authenticated' ? 'admin' : 'admin-login'} />
}

function PatientRouteGate() {
  const [state, setState] = useState<'checking' | 'authenticated' | 'anonymous'>('checking')

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(response => setState(response.ok ? 'authenticated' : 'anonymous'))
      .catch(() => setState('anonymous'))
  }, [])

  if (state === 'checking') {
    return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>Área do paciente</strong><small>Restaurando sua sessão</small></div></div><h1>Carregando...</h1><p>Aguarde enquanto abrimos sua área.</p></div></div>
  }

  return <App initialView={state === 'authenticated' ? 'paciente' : undefined} />
}

function RoutedApp() {
  if (path === '/admin/setup') return <AdminSetup />
  if (path === '/recuperar-senha') return <PasswordRecovery />
  if (path === '/admin' || path === '/admin/') return <AdminRouteGate />
  return <PatientRouteGate />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RoutedApp /></React.StrictMode>,
)
installPasswordEnhancer()
installAdminCalendarEnhancer()
installAdminStateEnhancer()
installPatientCalendarEnhancer()
installPatientPortalEnhancer()
installPatientWelcomeEnhancer()
installAdminAppointmentEnhancer()
installPricingUiEnhancer()
