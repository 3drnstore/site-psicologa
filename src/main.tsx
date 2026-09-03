import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './AppErrorBoundary'
import AdminSetup from './AdminSetup'
import PasswordRecovery from './PasswordRecovery'
import StatusPage from './StatusPage'
import PrivacyPage from './PrivacyPage'
import { api } from './api-client'
import { installPasswordEnhancer } from './password-enhancer'
import { installAdminCalendarEnhancer } from './admin-calendar-enhancer'
import { installAdminStateEnhancer } from './admin-state-enhancer'
import { installAdminSecurityEnhancer } from './admin-security-enhancer'
import { installAdminSessionSecurityEnhancer } from './admin-session-security-enhancer'
import { installAdmin2faEnhancer } from './admin-2fa-enhancer'
import { installPatientCalendarEnhancer } from './patient-calendar-enhancer'
import { installPatientPortalEnhancer } from './patient-portal-enhancer'
import { installPatientWelcomeEnhancer } from './patient-welcome-enhancer'
import { installPatientPaymentEnhancer } from './patient-payment-enhancer'
import { installPatientPaymentStabilizer } from './patient-payment-stabilizer'
import { installAdminAppointmentEnhancer } from './admin-appointment-enhancer'
import { installPricingUiEnhancer } from './pricing-ui-enhancer'
import { installPatientMessageEnhancer } from './patient-message-enhancer'
import { installAdminMessagesEnhancer } from './admin-messages-enhancer'
import { installPatientSelectionEnhancer } from './patient-selection-enhancer'
import { installPatientConsultationsEnhancer } from './patient-consultations-enhancer'
import { installD1FetchCache } from './d1-fetch-cache'
import { installProfessionalPresentationEnhancer } from './professional-presentation-enhancer'
import { installContactSectionEnhancer } from './contact-section-enhancer'
import { installPatientRouteSync } from './patient-route-sync'
import { installHomepageCtaSafe } from './homepage-cta-safe'
import { installAccessibilitySafe } from './accessibility-safe'
import { installAppResilience } from './app-resilience'
import { installPrivacyLinksSafe } from './privacy-links-safe'
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
import './status-page.css'
import './privacy-page.css'

const path = window.location.pathname

type GateState = 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

function SessionUnavailable({ professional = false, onRetry }: { professional?: boolean; onRetry: () => void }) {
  return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>{professional ? 'PsicoGestão' : 'Jacqueline Siqueira'}</strong><small>{professional ? 'Painel profissional' : 'Área do paciente'}</small></div></div><span className="section-kicker">Conexão temporariamente indisponível</span><h1>Não foi possível validar sua sessão agora.</h1><p>Sua sessão não foi encerrada. Aguarde alguns instantes e tente novamente.</p><button className="primary-button full" type="button" onClick={onRetry}>Tentar novamente</button><button className="text-button full" type="button" onClick={() => window.location.href='/status'}>Ver status do sistema</button></div></div>
}
function errorStatus(error: unknown) { return (error as Error & { status?: number })?.status }
function AdminRouteGate() {
  const [state,setState]=useState<GateState>('checking');const[attempt,setAttempt]=useState(0)
  useEffect(()=>{let active=true;setState('checking');api.adminMe().then(()=>{if(active)setState('authenticated')}).catch(error=>{if(!active)return;setState(errorStatus(error)===401?'anonymous':'unavailable')});return()=>{active=false}},[attempt])
  if(state==='checking')return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>PsicoGestão</strong><small>Painel profissional</small></div></div><h1>Carregando...</h1><p>Restaurando sua sessão e a tela em que você estava.</p></div></div>
  if(state==='unavailable')return <SessionUnavailable professional onRetry={()=>setAttempt(v=>v+1)}/>
  return <App initialView={state==='authenticated'?'admin':'admin-login'}/>
}
function PatientRouteGate() {
  const [state,setState]=useState<GateState>('checking');const[attempt,setAttempt]=useState(0)
  useEffect(()=>{let active=true;setState('checking');api.me().then(()=>{if(active)setState('authenticated')}).catch(error=>{if(!active)return;setState(errorStatus(error)===401?'anonymous':'unavailable')});return()=>{active=false}},[attempt])
  if(state==='checking')return <div className="patient-session-check" aria-hidden="true" />
  if(state==='unavailable')return <SessionUnavailable onRetry={()=>setAttempt(v=>v+1)}/>
  if(state==='anonymous'){if(window.location.pathname==='/paciente'||window.location.pathname==='/paciente/')window.history.replaceState({},'','/');return <App/>}
  return <App initialView="paciente"/>
}
function RoutedApp(){if(path==='/status'||path==='/status/')return <StatusPage/>;if(path==='/privacidade'||path==='/privacidade/')return <PrivacyPage/>;if(path==='/admin/setup')return <AdminSetup/>;if(path==='/recuperar-senha')return <PasswordRecovery/>;if(path==='/admin'||path==='/admin/')return <AdminRouteGate/>;if(path==='/paciente'||path==='/paciente/')return <PatientRouteGate/>;return <App/>}

installD1FetchCache();installAppResilience()
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><RoutedApp/></AppErrorBoundary></React.StrictMode>)
installPasswordEnhancer();installAdminCalendarEnhancer();installAdminStateEnhancer();installAdminSecurityEnhancer();installAdminSessionSecurityEnhancer();installAdmin2faEnhancer();installPatientCalendarEnhancer();installPatientPortalEnhancer();installPatientWelcomeEnhancer();installPatientPaymentEnhancer();installPatientPaymentStabilizer();installAdminAppointmentEnhancer();installPricingUiEnhancer();installPatientMessageEnhancer();installAdminMessagesEnhancer();installPatientSelectionEnhancer();installPatientConsultationsEnhancer();installProfessionalPresentationEnhancer();installContactSectionEnhancer();installHomepageCtaSafe();installAccessibilitySafe();installPrivacyLinksSafe();installPatientRouteSync()
