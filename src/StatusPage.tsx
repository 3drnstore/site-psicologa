import { useEffect, useState } from 'react'

type Health = {
  ok?: boolean
  service?: string
  release?: string
  worker?: string
  database?: string
  timestamp?: string
  message?: string
}

const browserOnline = () => navigator.onLine

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [dbLoading, setDbLoading] = useState(false)
  const [online, setOnline] = useState(browserOnline())

  async function loadHealth(probeDb = false) {
    probeDb ? setDbLoading(true) : setLoading(true)
    try {
      const response = await fetch(`/api/health${probeDb ? '?db=1' : ''}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as Health
      setHealth(data)
    } catch {
      setHealth({ ok: false, worker: 'unavailable', database: probeDb ? 'unknown' : 'not_checked', message: 'Não foi possível alcançar o Worker.' })
    } finally {
      setLoading(false)
      setDbLoading(false)
    }
  }

  useEffect(() => {
    void loadHealth(false)
    const update = () => setOnline(browserOnline())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const dbLabel = health?.database === 'online'
    ? 'Disponível'
    : health?.database === 'quota_exceeded'
      ? 'Cota diária atingida'
      : health?.database === 'unavailable'
        ? 'Indisponível'
        : health?.database === 'not_checked'
          ? 'Não testado'
          : 'Não verificado'

  return <main className="status-page">
    <section className="status-card">
      <span className="status-kicker">Diagnóstico técnico</span>
      <h1>Status do sistema</h1>
      <p>Esta tela verifica o frontend e o Worker sem consultar o banco automaticamente.</p>

      <div className="status-grid" aria-live="polite">
        <article><span>Navegador</span><strong>{online ? 'Online' : 'Sem internet'}</strong></article>
        <article><span>Worker</span><strong>{loading ? 'Verificando...' : health?.worker === 'online' ? 'Online' : 'Indisponível'}</strong></article>
        <article><span>Banco D1</span><strong>{dbLoading ? 'Testando...' : dbLabel}</strong></article>
        <article><span>Versão</span><strong>{health?.release || 'Não identificada'}</strong></article>
      </div>

      {health?.message && <div className="status-message">{health.message}</div>}

      <div className="status-actions">
        <button type="button" className="primary-button" disabled={dbLoading} onClick={() => void loadHealth(true)}>{dbLoading ? 'Testando...' : 'Testar banco'}</button>
        <button type="button" className="secondary-button" onClick={() => void loadHealth(false)}>Atualizar status</button>
        <a className="secondary-button" href="/">Voltar ao site</a>
      </div>

      <small>O teste do banco executa uma única consulta mínima e deve ser usado apenas quando necessário.</small>
    </section>
  </main>
}
