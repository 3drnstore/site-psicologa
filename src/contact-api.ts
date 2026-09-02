import type { Env } from './types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})

export async function handleContactApi(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/contact') return null
  if (request.method !== 'POST') return json({ ok: false, message: 'Método não permitido.' }, 405)

  const body = await request.json().catch(() => null) as any
  const name = String(body?.name || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = String(body?.phone || '').trim()
  const message = String(body?.message || '').trim()
  const honeypot = String(body?.website || '').trim()
  const startedAt = Number(body?.started_at || 0)

  // Bots simples costumam preencher campos invisíveis ou enviar o formulário instantaneamente.
  // Respondemos como sucesso para não ensinar o mecanismo de proteção ao remetente automático.
  if (honeypot) return json({ ok: true, message: 'Mensagem enviada com sucesso.' })
  if (startedAt > 0) {
    const elapsed = Date.now() - startedAt
    if (elapsed < 1800 || elapsed > 24 * 60 * 60 * 1000) {
      return json({ ok: true, message: 'Mensagem enviada com sucesso.' })
    }
  }

  if (!name || !email || !phone || !message) {
    return json({ ok: false, message: 'Preencha todos os campos.' }, 400)
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return json({ ok: false, message: 'Informe um e-mail válido.' }, 400)
  }
  if (name.length > 120 || email.length > 160 || phone.length > 30 || message.length > 3000) {
    return json({ ok: false, message: 'Um ou mais campos ultrapassaram o tamanho permitido.' }, 400)
  }

  await env.DB.prepare(`
    INSERT INTO contact_messages (name, email, phone, message)
    VALUES (?, ?, ?, ?)
  `).bind(name, email, phone, message).run()

  return json({ ok: true, message: 'Mensagem enviada com sucesso.' })
}
