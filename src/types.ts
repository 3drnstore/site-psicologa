export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  APP_ORIGIN?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_CALENDAR_ID?: string
  GOOGLE_REFRESH_TOKEN?: string
  MERCADOPAGO_ACCESS_TOKEN?: string
  MERCADOPAGO_WEBHOOK_SECRET?: string
  INFINITEPAY_HANDLE?: string
  PAYMENT_PROVIDER?: string
  PAYMENT_API_URL?: string
  PAYMENT_API_KEY?: string
  PAYMENT_WEBHOOK_SECRET?: string
  ADMIN_SETUP_TOKEN?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
}

export type PatientSession = {
  id: string
  full_name: string
  email: string
}

export type AdminSession = {
  id: string
  email: string
  display_name: string
  role: 'psychologist' | 'assistant'
}
