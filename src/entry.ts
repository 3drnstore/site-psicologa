import worker from './worker'
import { handleGoogleAuth } from './google-auth'
import { handleScheduleV2 } from './schedule-v2'
import { handlePaymentsV2 } from './payments-v2'
import { handleMercadoPagoPixV3 } from './mercadopago-pix-v3'
import { handleAdminSetup } from './admin-setup'
import { handleAuthV2 } from './auth-v2'
import { handleAuthLoginFast } from './auth-login-fast'
import { handleAgendaCreate } from './agenda-create'
import { handleAgendaDelete } from './agenda-delete'
import { handleAgendaBulk } from './agenda-bulk'
import { handlePublicAvailabilityV3 } from './public-availability-v3'
import { handlePatientReserveV2 } from './patient-reserve-v2'
import { handleAdminPatientsV2 } from './admin-patients-v2'
import { handlePricingV2 } from './pricing-v2'
import { handleContactApi } from './contact-api'
import { checkRateLimit } from './rate-limit'
import { handleHealthApi } from './health-api'
import { protectApiRequest } from './api-protection'
import type { Env } from './types'

const apiError = (message: string) => new Response(JSON.stringify({ ok: false, message }), {
  status: 500,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})

function withSecurityHeaders(response: Response, path: string) {
  const headers = new Headers(response.headers)
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  headers.set('X-Frame-Options', 'DENY')
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; upgrade-insecure-requests",
  )

  const privateRoute = path === '/admin' || path.startsWith('/admin/') || path === '/paciente' || path.startsWith('/paciente/') || path === '/recuperar-senha' || path === '/status' || path === '/status/'
  if (privateRoute) {
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    headers.set('Cache-Control', 'private, no-store')
  } else if (path === '/api/health') {
    headers.set('Cache-Control', 'no-store')
  } else if (path.startsWith('/assets/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (path === '/favicon.svg' || path === '/site.webmanifest') {
    headers.set('Cache-Control', 'public, max-age=86400')
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  const health = await handleHealthApi(request, env, path)
  if (health) return health

  const blocked = protectApiRequest(request, path)
  if (blocked) return blocked

  const limited = checkRateLimit(request, path)
  if (limited) return limited

  if (path === '/api/contact') {
    try {
      const response = await handleContactApi(request, env, path)
      if (response) return response
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('Contact API error:', detail)
      return apiError('Não foi possível enviar a mensagem agora.')
    }
  }

  if (path === '/api/admin/setup' || path === '/api/admin/setup-status') {
    const response = await handleAdminSetup(request, env)
    if (response) return response
  }

  const fastAuth = await handleAuthLoginFast(request, env, path)
  if (fastAuth) return fastAuth

  const authV2 = await handleAuthV2(request, env, path)
  if (authV2) return authV2

  if (path === '/api/admin/patients' || /^\/api\/admin\/patients\/\d+$/.test(path)) {
    const response = await handleAdminPatientsV2(request, env, path)
    if (response) return response
  }

  if (path === '/api/admin/settings') {
    const response = await handlePricingV2(request, env, path)
    if (response) return response
  }

  if (path === '/api/appointments/reserve' && request.method === 'POST') {
    const response = await handlePatientReserveV2(request, env, path)
    if (response) return response
  }

  if (path.startsWith('/api/payments/')) {
    try {
      if (path === '/api/payments/checkout' && request.method === 'POST') {
        const probe = await request.clone().json().catch(() => ({})) as any
        if (probe.method === 'pix') {
          const pixResponse = await handleMercadoPagoPixV3(request, env, path)
          if (pixResponse) return pixResponse
        }
      }

      const response = await handlePaymentsV2(request, env, path, ctx)
      if (response) return response
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('Payment API error:', detail)
      return apiError('Não foi possível iniciar o pagamento agora.')
    }
  }

  const isAgendaRoute =
    (path === '/api/admin/availability' && request.method === 'POST') ||
    path === '/api/admin/availability/bulk' ||
    path === '/api/availability' ||
    path === '/api/admin/availability-v2' ||
    path.startsWith('/api/admin/recurring-blocks') ||
    /^\/api\/admin\/availability\/\d+(?:\/mode)?$/.test(path)

  if (isAgendaRoute) {
    try {
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

      if (path === '/api/availability' && request.method === 'GET') {
        const response = await handlePublicAvailabilityV3(request, env, path)
        if (response) return response
      }

      const response = await handleScheduleV2(request, env, path)
      if (response) return response
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('Agenda API error:', detail)
      return apiError('A agenda está temporariamente indisponível. Tente novamente em alguns minutos.')
    }
  }

  if (path.startsWith('/api/auth/google/')) {
    const response = await handleGoogleAuth(request, env)
    if (response) return response
  }

  return worker.fetch(request, env, ctx as any)
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname
    const response = await handleRequest(request, env, ctx)
    return withSecurityHeaders(response, path)
  },
}
