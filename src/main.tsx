import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminSetup from './AdminSetup'
import PasswordRecovery from './PasswordRecovery'
import { installPasswordEnhancer } from './password-enhancer'
import { installAdminCalendarEnhancer } from './admin-calendar-enhancer'
import './styles.css'
import './app-extra.css'
import './v2.css'
import './admin-calendar.css'

const path = window.location.pathname

function RoutedApp() {
  if (path === '/admin/setup') return <AdminSetup />
  if (path === '/recuperar-senha') return <PasswordRecovery />
  return <App initialView={path === '/admin' || path === '/admin/' ? 'admin-login' : undefined} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RoutedApp /></React.StrictMode>,
)
installPasswordEnhancer()
installAdminCalendarEnhancer()
