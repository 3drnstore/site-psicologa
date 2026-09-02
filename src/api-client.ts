export type ApiError = { message?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({})) as T & ApiError
  if (!response.ok) {
    const error = new Error(data.message || 'Não foi possível concluir a solicitação.') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return data
}

const PATIENT_CACHE_KEY = 'ps_recent_patient'
const ADMIN_CACHE_KEY = 'ps_recent_admin'

function writeSessionCache(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function readSessionCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch { return null }
}

function clearSessionCache(key: string) {
  try { sessionStorage.removeItem(key) } catch {}
}

async function loginPatient(email: string, password: string) {
  const result = await request<any>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  if (result?.patient) writeSessionCache(PATIENT_CACHE_KEY, result.patient)
  return result
}

async function currentPatient() {
  try {
    const result = await request<any>('/api/me')
    if (result?.patient) writeSessionCache(PATIENT_CACHE_KEY, result.patient)
    return result
  } catch (error) {
    const status = (error as Error & { status?: number }).status
    if (status === 401) {
      clearSessionCache(PATIENT_CACHE_KEY)
      throw error
    }
    const patient = readSessionCache<any>(PATIENT_CACHE_KEY)
    if (patient) return { ok: true, patient, degraded: true }
    throw error
  }
}

async function loginAdmin(email: string, password: string) {
  const result = await request<any>('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  if (result?.admin) writeSessionCache(ADMIN_CACHE_KEY, result.admin)
  return result
}

async function currentAdmin() {
  try {
    const result = await request<any>('/api/admin/me')
    if (result?.admin) writeSessionCache(ADMIN_CACHE_KEY, result.admin)
    return result
  } catch (error) {
    const status = (error as Error & { status?: number }).status
    if (status === 401) {
      clearSessionCache(ADMIN_CACHE_KEY)
      throw error
    }
    const admin = readSessionCache<any>(ADMIN_CACHE_KEY)
    if (admin) return { ok: true, admin, degraded: true }
    throw error
  }
}

export const api = {
  health: () => request<{ ok: boolean; database: string }>('/api/health'),
  register: (payload: Record<string, string>) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  completeGoogle: (payload: Record<string, string>) => request('/api/auth/google/complete', { method: 'POST', body: JSON.stringify(payload) }),
  login: loginPatient,
  logout: async () => { try { return await request('/api/auth/logout', { method: 'POST' }) } finally { clearSessionCache(PATIENT_CACHE_KEY) } },
  me: currentPatient,
  availability: (from?: string, to?: string) => request<any>(`/api/availability?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`).catch(() => ({ ok: true, slots: [], consultation_price_cents: 0, card_price_cents: 0, pix_price_cents: 0 })),
  reserve: (slotId: string | number) => request<any>('/api/appointments/reserve', { method: 'POST', body: JSON.stringify({ slot_id: slotId }) }),
  myAppointments: () => request<any>('/api/appointments/mine').catch(() => ({ ok: true, appointments: [] })),
  cancelAppointment: (appointmentId: string | number) => request(`/api/appointments/${appointmentId}/cancel`, { method: 'POST' }),
  checkout: (appointmentId: string | number, method: 'pix'|'card') => request<any>('/api/payments/checkout', { method: 'POST', body: JSON.stringify({ appointment_id: appointmentId, method }) }),
  adminLogin: loginAdmin,
  adminLogout: async () => { try { return await request('/api/admin/logout', { method: 'POST' }) } finally { clearSessionCache(ADMIN_CACHE_KEY) } },
  adminMe: currentAdmin,
  adminPatients: () => request<any>('/api/admin/patients').catch(() => ({ ok: true, patients: [] })),
  adminPatient: (id: string | number) => request<any>(`/api/admin/patients/${encodeURIComponent(String(id))}`),
  saveClinicalNote: (patientId: string | number, payload: { appointment_id?: string | number; session_date: string; note_text: string }) => request(`/api/admin/patients/${encodeURIComponent(String(patientId))}/notes`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteClinicalNote: (id: string) => request(`/api/admin/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminAppointments: () => request<any>('/api/admin/appointments').catch(() => ({ ok: true, appointments: [] })),
  setAppointmentStatus: (id: string | number, status: 'confirmed' | 'cancelled', reason?: string) => request(`/api/admin/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }),
  createSlot: (payload: { starts_at: string; ends_at: string }) => request('/api/admin/availability', { method: 'POST', body: JSON.stringify(payload) }),
  adminAvailability: (from?: string, to?: string) => (!from&&!to)
    ? Promise.resolve({ ok: true, slots: [], recurring_blocks: [] })
    : request<any>(`/api/admin/availability-v2?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`).catch(() => ({ ok: true, slots: [], recurring_blocks: [] })),
  setSlotMode: (slotId: string | number, mode: 'free' | 'blocked' | 'hidden' | 'visible') => request(`/api/admin/availability/${encodeURIComponent(String(slotId))}/mode`, { method: 'PATCH', body: JSON.stringify({ mode }) }),
  deleteSlot: (slotId: string | number) => request(`/api/admin/availability/${encodeURIComponent(String(slotId))}`, { method: 'DELETE' }),
  createRecurringBlock: (payload: { weekdays: number[]; start_time: string; end_time: string; date_from?: string; date_to?: string; label?: string }) => request<any>('/api/admin/recurring-blocks', { method: 'POST', body: JSON.stringify(payload) }),
  setRecurringBlockActive: (id: string, active: boolean) => request(`/api/admin/recurring-blocks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  settings: () => request<any>('/api/admin/settings').catch(() => ({ ok: true, settings: {} })),
  updateSettings: (payload: Record<string, string | number>) => request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) }),
}
