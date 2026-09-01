export type ApiError = { message?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({})) as T & ApiError
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a solicitação.')
  return data
}

export const api = {
  health: () => request<{ ok: boolean; database: string }>('/api/health'),
  register: (payload: Record<string, string>) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (email: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  availability: (from?: string, to?: string) => request(`/api/availability?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`),
  reserve: (slotId: string) => request('/api/appointments/reserve', { method: 'POST', body: JSON.stringify({ slot_id: slotId }) }),
  myAppointments: () => request('/api/appointments/mine'),
  checkout: (appointmentId: string, method: 'pix' | 'card') => request('/api/payments/checkout', { method: 'POST', body: JSON.stringify({ appointment_id: appointmentId, method }) }),
  adminLogin: (email: string, password: string) => request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST' }),
  adminPatients: () => request('/api/admin/patients'),
  adminPatient: (id: string) => request(`/api/admin/patients/${encodeURIComponent(id)}`),
  saveClinicalNote: (patientId: string, payload: { appointment_id?: string; session_date: string; note_text: string }) => request(`/api/admin/patients/${encodeURIComponent(patientId)}/notes`, { method: 'POST', body: JSON.stringify(payload) }),
  adminAppointments: () => request('/api/admin/appointments'),
  createSlot: (payload: { starts_at: string; ends_at: string }) => request('/api/admin/availability', { method: 'POST', body: JSON.stringify(payload) }),
  blockSlot: (slotId: string, blocked: boolean) => request(`/api/admin/availability/${encodeURIComponent(slotId)}`, { method: 'PATCH', body: JSON.stringify({ blocked }) }),
  settings: () => request('/api/admin/settings'),
  updateSettings: (payload: Record<string, string | number>) => request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) }),
}
