import { FormEvent, useEffect, useState } from 'react'

export default function AdminSetup() {
  const [status, setStatus] = useState<'loading'|'available'|'configured'|'error'>('loading')
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetch('/api/admin/setup-status', { credentials: 'include' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.message || 'Não foi possível verificar o status do administrador.')
        setStatus(data.configured ? 'configured' : 'available')
      })
      .catch((e) => { setStatus('error'); setMessage(e instanceof Error ? e.message : 'Erro ao verificar configuração.') })
  }, [])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMessage('')
    const fd = new FormData(e.currentTarget)
    const password = String(fd.get('password') || '')
    const confirm = String(fd.get('confirm_password') || '')
    if (password !== confirm) { setMessage('As senhas não coincidem.'); return }
    const setupToken = String(fd.get('setup_token') || '')
    try {
      const response = await fetch('/api/admin/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-setup-token': setupToken },
        body: JSON.stringify({
          display_name: String(fd.get('display_name') || ''),
          email: String(fd.get('email') || ''),
          password,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Não foi possível criar o administrador.')
      setSuccess(true); setStatus('configured')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Erro ao criar administrador.') }
  }

  return <div className="auth-page">
    <a className="back-link" href="/">← Voltar ao site</a>
    <div className="auth-card">
      <div className="auth-brand"><span className="brand-mark">ψ</span><div><strong>PsicoGestão</strong><small>Configuração inicial</small></div></div>
      <span className="section-kicker">Primeiro acesso</span>
      <h1>Criar administrador</h1>
      {status === 'loading' && <p>Verificando configuração do sistema...</p>}
      {status === 'error' && <div className="error-box">{message}</div>}
      {success && <div className="info-box">Administrador criado com sucesso. Esta tela não permitirá um segundo cadastro.</div>}
      {status === 'configured' && !success && <div className="record-warning">O administrador inicial já foi configurado. Use o acesso profissional na página principal.</div>}
      {status === 'configured' && <a className="primary-button full" href="/">Ir para o site</a>}
      {status === 'available' && <>
        <p>Cadastre o primeiro acesso profissional. Depois da criação, esta configuração inicial será automaticamente bloqueada.</p>
        {message && <div className="error-box">{message}</div>}
        <form onSubmit={submit}>
          <label>Nome da psicóloga<input name="display_name" required placeholder="Nome completo" /></label>
          <label>E-mail<input name="email" required type="email" placeholder="email@exemplo.com" /></label>
          <label>Senha<input name="password" required type="password" minLength={10} placeholder="Mínimo de 10 caracteres" /></label>
          <label>Confirmar senha<input name="confirm_password" required type="password" minLength={10} /></label>
          <label>Chave de configuração<input name="setup_token" required type="password" placeholder="ADMIN_SETUP_TOKEN" /></label>
          <button className="primary-button full" type="submit">Criar administrador</button>
        </form>
        <small className="privacy-note">A chave de configuração fica armazenada somente como Secret na Cloudflare e não é salva no GitHub.</small>
      </>}
    </div>
  </div>
}
