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
import { installAdminConsultationsV2 } from './admin-consultations-v2'
import { installAdminSecurityEnhancer } from './admin-security-enhancer'
import { installAdminSessionSecurityEnhancer } from './admin-session-security-enhancer'
import { installAdmin2faEnhancer } from './admin-2fa-enhancer'
import { installAdminConfigMenuEnhancer } from './admin-config-menu-enhancer'
import { installPatientDefaultSessionsEnhancer } from './patient-default-sessions-enhancer'
import { installPatientPortalEnhancer } from './patient-portal-enhancer'
import { installPatientWeekPolish } from './patient-week-polish'
import { installPatientSecurityDeletePolish } from './patient-security-delete-polish'
import { installAdminAppointmentEnhancer } from './admin-appointment-enhancer'
import { installAdminPatientRecurrenceEnhancer } from './admin-patient-recurrence-enhancer'
import { installAdminClinicalNotesEnhancer } from './admin-clinical-notes-enhancer'
import { installAdminPatientWorkspaceEnhancer } from './admin-patient-workspace-enhancer'
import { installAdminDashboardSessionState } from './admin-dashboard-session-state'
import { installPricingUiEnhancer } from './pricing-ui-enhancer'
import { installAdminPlatformPricingEnhancer } from './admin-platform-pricing-enhancer'
import { installPlatformInviteEnhancer } from './platform-invite-enhancer'
import { installPatientMessageEnhancer } from './patient-message-enhancer'
import { installAdminMessagesEnhancer } from './admin-messages-enhancer'
import { installD1FetchCache } from './d1-fetch-cache'
import { installProfessionalPresentationEnhancer } from './professional-presentation-enhancer'
import { installContactSectionEnhancer } from './contact-section-enhancer'
import { installPatientRouteSync } from './patient-route-sync'
import { installHomepageCtaSafe } from './homepage-cta-safe'
import { installAccessibilitySafe } from './accessibility-safe'
import { installAppResilience } from './app-resilience'
import { installPrivacyLinksSafe } from './privacy-links-safe'
import { installTerminologyEnhancer } from './terminology-enhancer'
import { installSessionManagementUi } from './session-management-ui'
import { installPatientFlowHotfix } from './patient-flow-hotfix'
import { installAdminReceitaSaudeEnhancer } from './admin-receita-saude-enhancer'
import { installAdminFinanceEnhancer } from './admin-finance-enhancer'
import './styles.css'
import './app-extra.css'
import './v2.css'
import './admin-calendar.css'
import './patient-portal.css'
import './patient-portal-polish.css'
import './professional-presentation.css'
import './clinical-care-section.css'
import './contact-section.css'
import './homepage-cta-safe.css'
import './accessibility-safe.css'
import './app-resilience.css'
import './status-page.css'
import './privacy-page.css'
import './admin-blue-theme.css'

const path = window.location.pathname
const isAdminPath=path==='/admin'||path==='/admin/'||path==='/admin/setup'||path.startsWith('/admin/configuracoes/')
const isPatientPath=path==='/paciente'||path==='/paciente/'

type GateState = 'checking' | 'authenticated' | 'anonymous' | 'unavailable'

function SessionUnavailable({ professional = false, onRetry }: { professional?: boolean; onRetry: () => void }) {
  return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>{professional ? 'Painel Administrativo' : 'Jacqueline Siqueira'}</strong><small>{professional ? 'Painel profissional' : 'Área do paciente'}</small></div></div><span className="section-kicker">Conexão temporariamente indisponível</span><h1>Não foi possível validar sua sessão agora.</h1><p>Sua sessão não foi encerrada. Aguarde alguns instantes e tente novamente.</p><button className="primary-button full" type="button" onClick={onRetry}>Tentar novamente</button><button className="text-button full" type="button" onClick={() => window.location.href='/status'}>Ver status do sistema</button></div></div>
}
function errorStatus(error: unknown) { return (error as Error & { status?: number })?.status }
function AdminRouteGate() {
  const [state,setState]=useState<GateState>('checking');const[attempt,setAttempt]=useState(0)
  useEffect(()=>{let active=true;setState('checking');api.adminMe().then(()=>{if(active)setState('authenticated')}).catch(error=>{if(!active)return;setState(errorStatus(error)===401?'anonymous':'unavailable')});return()=>{active=false}},[attempt])
  useEffect(()=>{if(state!=='checking')document.documentElement.classList.remove('admin-boot')},[state])
  if(state==='checking')return null
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
function RoutedApp(){if(path==='/status'||path==='/status/')return <StatusPage/>;if(path==='/privacidade'||path==='/privacidade/')return <PrivacyPage/>;if(path==='/admin/setup')return <AdminSetup/>;if(path==='/recuperar-senha')return <PasswordRecovery/>;if(path==='/admin'||path==='/admin/'||path.startsWith('/admin/configuracoes/'))return <AdminRouteGate/>;if(isPatientPath)return <PatientRouteGate/>;return <App/>}

function safeInstall(name:string, installer:()=>void){try{installer()}catch(error){console.error(`Falha ao iniciar ${name}:`,error)}}

safeInstall('cache D1',installD1FetchCache)
safeInstall('resiliência',installAppResilience)
safeInstall('acessibilidade',installAccessibilitySafe)
safeInstall('terminologia',installTerminologyEnhancer)
safeInstall('senhas',installPasswordEnhancer)
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><RoutedApp/></AppErrorBoundary></React.StrictMode>)

let patientModulesInstalled=false
function installPatientModules(){
  if(patientModulesInstalled)return
  patientModulesInstalled=true
  safeInstall('sessões padrão do paciente',installPatientDefaultSessionsEnhancer)
  safeInstall('portal do paciente',installPatientPortalEnhancer)
  safeInstall('semana do paciente',installPatientWeekPolish)
  safeInstall('exclusão de conta do paciente',installPatientSecurityDeletePolish)
  safeInstall('mensagens do paciente',installPatientMessageEnhancer)
  safeInstall('sincronização de rota do paciente',installPatientRouteSync)
  safeInstall('gestão de sessões',installSessionManagementUi)
  safeInstall('correções do fluxo do paciente',installPatientFlowHotfix)
}

if(isAdminPath){
  // Somente os módulos administrativos observam o DOM do painel.
  safeInstall('espaço do paciente',installAdminPatientWorkspaceEnhancer)
  safeInstall('recorrência do paciente',installAdminPatientRecurrenceEnhancer)
  safeInstall('anotações clínicas',installAdminClinicalNotesEnhancer)
  safeInstall('calendário administrativo',installAdminCalendarEnhancer)
  safeInstall('estado administrativo',installAdminStateEnhancer)
  safeInstall('financeiro administrativo',installAdminFinanceEnhancer)
  safeInstall('consultas administrativas',installAdminConsultationsV2)
  safeInstall('segurança administrativa',installAdminSecurityEnhancer)
  safeInstall('segurança de sessão administrativa',installAdminSessionSecurityEnhancer)
  safeInstall('2FA administrativo',installAdmin2faEnhancer)
  safeInstall('menu de configurações',installAdminConfigMenuEnhancer)
  safeInstall('consultas administrativas complementares',installAdminAppointmentEnhancer)
  safeInstall('estado da sessão do painel',installAdminDashboardSessionState)
  safeInstall('preços administrativos',installAdminPlatformPricingEnhancer)
  safeInstall('mensagens administrativas',installAdminMessagesEnhancer)
  safeInstall('gestão de sessões',installSessionManagementUi)
  safeInstall('controle Receita Saúde',installAdminReceitaSaudeEnhancer)
}else{
  if(isPatientPath)installPatientModules()
  else{
    // O login troca o App público pelo portal sem recarregar a página.
    // O detector permanece ativo até o portal surgir, independentemente de quanto tempo
    // o paciente fique na página de login antes de entrar.
    const root=document.getElementById('root')
    const detectPatient=()=>{
      if(document.querySelector('.patient-page')){installPatientModules();return true}
      return false
    }
    if(!detectPatient()&&root){
      const observer=new MutationObserver(()=>{if(detectPatient())observer.disconnect()})
      observer.observe(root,{childList:true,subtree:true})
    }
  }
  if(!isPatientPath){
    safeInstall('convite da plataforma',installPlatformInviteEnhancer)
    safeInstall('preços',installPricingUiEnhancer)
    safeInstall('apresentação profissional',installProfessionalPresentationEnhancer)
    safeInstall('contato',installContactSectionEnhancer)
    safeInstall('CTA da página inicial',installHomepageCtaSafe)
    safeInstall('links de privacidade',installPrivacyLinksSafe)
  }
}
