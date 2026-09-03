import { ensureSchema } from './schema'
import type { Env } from './types'

let pending: Promise<void> | null = null

export async function ensureSchemaReady(env: Env) {
  if (!pending) {
    pending = ensureSchema(env).catch(error => {
      pending = null
      throw error
    })
  }
  await pending
}
