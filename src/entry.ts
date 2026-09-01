import worker from './worker'
import { ensureSchema } from './schema'
import { handleGoogleAuth } from './google-auth'
import { handleScheduleV2 } from './schedule-v2'
import { handlePaymentsV2 } from './payments-v2'
import { handleAdminSetup } from './admin-setup'
import type { Env } from './types'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // O primeiro administrador não deve depender da inicialização completa
    // de agenda, pagamentos ou prontuário. Isso permite recuperar/configurar
    // o acesso profissional mesmo se outra migration estiver com problema.
    if (path === '/api/admin/setup' || path === '/api/admin/setup-status') {
      const response = await handleAdminSetup(request, env)
      if (response) return response
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

    if (path === '/api/availability' || path === '/api/admin/availability-v2' || path.startsWith('/api/admin/recurring-blocks') || /^\/api\/admin\/availability\/\d+\/mode$/.test(path)) {
      const response = await handleScheduleV2(request, env, path)
      if (response) return response
    }

    return worker.fetch(request, env, ctx as any)
  },
}
