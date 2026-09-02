import React from 'react'

type State = { hasError: boolean }

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('Frontend error boundary:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="app-crash-page" role="alert">
        <section className="app-crash-card">
          <span className="brand-mark" aria-hidden="true">ψ</span>
          <small>Jacqueline Siqueira • Psicologia</small>
          <h1>Não foi possível carregar esta tela.</h1>
          <p>O site encontrou um erro temporário. Você pode tentar carregar a página novamente sem perder sua conta.</p>
          <div className="app-crash-actions">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>Recarregar página</button>
            <button type="button" className="secondary-button" onClick={() => { window.location.href = '/' }}>Ir para o início</button>
          </div>
        </section>
      </main>
    )
  }
}
