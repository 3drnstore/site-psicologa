import worker from './worker'
import { ensureSchema } from './schema'
import type { Env } from './types'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) await ensureSchema(env)
    return worker.fetch(request, env, ctx as any)
  },
}
