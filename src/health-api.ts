import type { Env } from './types'

export const APP_RELEASE = '2026.09.02-observability-v1'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

export async function handleHealthApi(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/health' || request.method !== 'GET') return null

  const url = new URL(request.url)
  const probeDatabase = url.searchParams.get('db') === '1'
  const base = {
    ok: true,
    service: 'site-psicologa',
    release: APP_RELEASE,
    worker: 'online',
    timestamp: new Date().toISOString(),
  }

  if (!probeDatabase) return json({ ...base, database: 'not_checked' })

  try {
    const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    return json({ ...base, database: row?.ok === 1 ? 'online' : 'unexpected_response' })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('Health D1 probe error:', detail)
    const quotaExceeded = /exceeded|free tier|row read limit/i.test(detail)
    return json({
      ...base,
      ok: false,
      database: quotaExceeded ? 'quota_exceeded' : 'unavailable',
      message: quotaExceeded
        ? 'A cota diária do banco de dados foi atingida.'
        : 'O banco de dados está temporariamente indisponível.',
    }, 503)
  }
}
