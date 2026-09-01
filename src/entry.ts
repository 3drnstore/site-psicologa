import worker from './worker'
import { ensureSchema } from './schema'
import { handleGoogleAuth } from './google-auth'
import { handleScheduleV2 } from './schedule-v2'
import { handlePaymentsV2 } from './payments-v2'
import { handleAdminSetup } from './admin-setup'
import { handleAuthV2 } from './auth-v2'
import { handleAgendaCreate } from './agenda-create'
import { handleAgendaDelete } from './agenda-delete'
import { handleAgendaBulk } from './agenda-bulk'
import { ensureAgendaSchema } from './agenda-schema'
import { cleanupLegacyAgenda } from './agenda-normalize'
import type { Env } from './types'

const apiError = (message: string, detail?: string) => new Response(JSON.stringify({ ok: false, message, detail }), {
  status: 500,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/admin/setup' || path === '/api/admin/setup-status') {
      const response = await handleAdminSetup(request, env)
      if (response) return response
    }

    const authV2 = await handleAuthV2(request, env, path)
    if (authV2) return authV2

    const isAgendaRoute =
      (path === '/api/admin/availability' && request.method === 'POST') ||
      path === '/api/admin/availability/bulk' ||
      path === '/api/availability' ||
      path === '/api/admin/availability-v2' ||
      path.startsWith('/api/admin/recurring-blocks') ||
      /^\/api\/admin\/availability\/\d+(?:\/mode)?$/.test(path)

    if (isAgendaRoute) {
      try {
        await ensureAgendaSchema(env)

        // A agenda atual usa exclusivamente sessões de 50 minutos,
        // de segunda a sábado, iniciando em hora cheia. Cadastros antigos
        // livres/bloqueados fora desse padrão são removidos quando não
        // possuem consulta ativa vinculada. Isso também elimina conflitos
        // causados pelos testes antigos de intervalos longos e de 1 hora.
        if (path.startsWith('/api/admin/')) {
          await cleanupLegacyAgenda(env)
        }

        if (path === '/api/admin/availability' && request.method === 'POST') {
          const response = await handleAgendaCreate(request, env, path)
          if (response) return response
        }

        if (path === '/api/admin/availability/bulk' && request.method === 'POST') {
          const response = await handleAgendaBulk(request, env, path)
          if (response) return response
        }

        if (/^\/api\/admin\/availability\/\d+$/.test(path) && request.method === 'DELETE') {
          const response = await handleAgendaDelete(request, env, path)
          if (response) return response
        }

        const response = await handleScheduleV2(request, env, path)
        if (response) return response
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        console.error('Agenda API error:', detail)
        return apiError('Erro interno da Agenda. O sistema já identificou a causa técnica.', detail)
      }
    }

    if (path.startsWith('/api/')) await ensureSchema(env)

    if (path.startsWith('/api/auth/google/')) {
      const response = await handleGoogleAuth(request, env)
      if (response) return response
    }

    if (path === '/api/payments/checkout' || path.startsWith('/api/payments/webhook/sumup') || path.startsWith('/api/payments/webhook/infinitepay')) {
      const response = await handlePaymentsV2(request, env, path, ctx)
      if (response) return response
    }

    return worker.fetch(request, env, ctx as any)
  },
}
