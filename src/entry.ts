import worker from './worker'
import { ensureSchema } from './schema'
import { handleGoogleAuth } from './google-auth'
import type { Env } from './types'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) await ensureSchema(env)
    if (url.pathname.startsWith('/api/auth/google/')) {
      const response = await handleGoogleAuth(request, env)
      if (response) return response
    }
    return worker.fetch(request, env, ctx as any)
  },
}
