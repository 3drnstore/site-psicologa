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
  MERCADOPAGO_TEST_MODE?: string
  INFINITEPAY_HANDLE?: string
  PAYMENT_PROVIDER?: string
  PAYMENT_API_URL?: string
  PAYMENT_API_KEY?: string
  PAYMENT_WEBHOOK_SECRET?: string
  ADMIN_SETUP_TOKEN?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  WHATSAPP_PHONE_NUMBER_ID?: string
  WHATSAPP_ACCESS_TOKEN?: string
  WHATSAPP_API_VERSION?: string
  WHATSAPP_TEMPLATE_LANGUAGE?: string
  WHATSAPP_TEMPLATE_RESCHEDULED?: string
  WHATSAPP_TEMPLATE_CANCELLED?: string
  WHATSAPP_TEMPLATE_PAYMENT_REMINDER?: string
  WHATSAPP_TEMPLATE_PAYMENT_FINAL?: string
  WHATSAPP_TEMPLATE_RESERVATION_EXPIRED?: string
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
