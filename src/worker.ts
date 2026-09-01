export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      try {
        const result = await env.DB.prepare('SELECT 1 AS ok').first()
        return Response.json({
          ok: true,
          database: result?.ok === 1 ? 'connected' : 'unexpected-response',
          worker: 'site-psicologa',
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        return Response.json(
          {
            ok: false,
            database: 'error',
            message: error instanceof Error ? error.message : 'Unknown database error',
          },
          { status: 500 },
        )
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ ok: false, message: 'API route not found' }, { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}
