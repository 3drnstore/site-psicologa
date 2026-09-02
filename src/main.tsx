import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './AppErrorBoundary'
import AdminSetup from './AdminSetup'
import PasswordRecovery from './PasswordRecovery'
import { installPasswordEnhancer } from './password-enhancer'
import { installAdminCalendarEnhancer } from './admin-calendar-enhancer'
import { installAdminStateEnhancer } from './admin-state-enhancer'
import { installPatientCalendarEnhancer } from './patient-calendar-enhancer'
import { installPatientPortalEnhancer } from './patient-portal-enhancer'
import { installPatientWelcomeEnhancer } from './patient-welcome-enhancer'
import { installPatientPaymentEnhancer } from './patient-payment-enhancer'
import { installPatientPaymentStabilizer } from './patient-payment-stabilizer'
import { installPaymentProviderCopyEnhancer } from './payment-provider-copy-enhancer'
import { installAdminAppointmentEnhancer } from './admin-appointment-enhancer'
import { installPricingUiEnhancer } from './pricing-ui-enhancer'
import { installPatientMessageEnhancer } from './patient-message-enhancer'
import { installPatientSelectionEnhancer } from './patient-selection-enhancer'
import { installPatientConsultationsEnhancer } from './patient-consultations-enhancer'
import { installD1FetchCache } from './d1-fetch-cache'
import { installProfessionalPresentationEnhancer } from './professional-presentation-enhancer'
import { installContactSectionEnhancer } from './contact-section-enhancer'
import { installPatientRouteSync } from './patient-route-sync'
import { installHomepageCtaSafe } from './homepage-cta-safe'
import { installProfessionalIdentitySafe } from './professional-identity-safe'
import { installAccessibilitySafe } from './accessibility-safe'
import { installAppResilience } from './app-resilience'
import './styles.css'
import './app-extra.css'
import './v2.css'
import './admin-calendar.css'
import './patient-calendar.css'
import './patient-calendar-boot.css'
import './patient-portal.css'
import './patient-booking-khaki.css'
import './patient-consultations.css'
import './patient-selection-fix.css'
import './professional-presentation.css'
import './clinical-care-section.css'
import './contact-section.css'
import './homepage-cta-safe.css'
import './accessibility-safe.css'
import './app-resilience.css'

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
    fetch('/api/me', { credentials: 'include', cache: 'no-store' })
      .then(response => setState(response.ok ? 'authenticated' : 'anonymous'))
      .catch(() => setState('anonymous'))
  }, [])

  if (state === 'checking') return <div className="patient-session-check" aria-hidden="true" />

  if (state === 'anonymous') {
    if (window.location.pathname === '/paciente' || window.location.pathname === '/paciente/') {
      window.history.replaceState({}, '', '/')
    }
    return <App />
  }

  return <App initialView="paciente" />
}

function RoutedApp() {
  if (path === '/admin/setup') return <AdminSetup />
  if (path === '/recuperar-senha') return <PasswordRecovery />
  if (path === '/admin' || path === '/admin/') return <AdminRouteGate />
  if (path === '/paciente' || path === '/paciente/') return <PatientRouteGate />
  return <App />
}

installD1FetchCache()
installAppResilience()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AppErrorBoundary><RoutedApp /></AppErrorBoundary></React.StrictMode>,
)
installPasswordEnhancer()
installAdminCalendarEnhancer()
installAdminStateEnhancer()
installPatientCalendarEnhancer()
installPatientPortalEnhancer()
installPatientWelcomeEnhancer()
installPatientPaymentEnhancer()
installPatientPaymentStabilizer()
installPaymentProviderCopyEnhancer()
installAdminAppointmentEnhancer()
installPricingUiEnhancer()
installPatientMessageEnhancer()
installPatientSelectionEnhancer()
installPatientConsultationsEnhancer()
installProfessionalPresentationEnhancer()
installProfessionalIdentitySafe()
installContactSectionEnhancer()
installHomepageCtaSafe()
installAccessibilitySafe()
installPatientRouteSync()
