import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminSetup from './AdminSetup'
import './styles.css'
import './app-extra.css'
import './v2.css'

const Root = window.location.pathname === '/admin/setup' ? AdminSetup : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
