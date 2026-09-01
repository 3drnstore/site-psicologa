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
  completeGoogle: (payload: Record<string, string>) => request('/api/auth/google/complete', { method: 'POST', body: JSON.stringify(payload) }),
  login: (email: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request<any>('/api/me'),
  availability: (from?: string, to?: string) => request<any>(`/api/availability?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`),
  reserve: (slotId: string | number) => request<any>('/api/appointments/reserve', { method: 'POST', body: JSON.stringify({ slot_id: slotId }) }),
  myAppointments: () => request<any>('/api/appointments/mine'),
  cancelAppointment: (appointmentId: string | number) => request(`/api/appointments/${appointmentId}/cancel`, { method: 'POST' }),
  checkout: (appointmentId: string | number, method: 'pix' | 'card') => request<any>('/api/payments/checkout', { method: 'POST', body: JSON.stringify({ appointment_id: appointmentId, method }) }),
  adminLogin: (email: string, password: string) => request<any>('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST' }),
  adminMe: () => request<any>('/api/admin/me'),
  adminPatients: () => request<any>('/api/admin/patients'),
  adminPatient: (id: string | number) => request<any>(`/api/admin/patients/${encodeURIComponent(String(id))}`),
  saveClinicalNote: (patientId: string | number, payload: { appointment_id?: string | number; session_date: string; note_text: string }) => request(`/api/admin/patients/${encodeURIComponent(String(patientId))}/notes`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteClinicalNote: (id: string) => request(`/api/admin/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminAppointments: () => request<any>('/api/admin/appointments'),
  setAppointmentStatus: (id: string | number, status: 'confirmed' | 'cancelled', reason?: string) => request(`/api/admin/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }),
  createSlot: (payload: { starts_at: string; ends_at: string }) => request('/api/admin/availability', { method: 'POST', body: JSON.stringify(payload) }),
  blockSlot: (slotId: string | number, blocked: boolean) => request(`/api/admin/availability/${encodeURIComponent(String(slotId))}`, { method: 'PATCH', body: JSON.stringify({ blocked }) }),
  settings: () => request<any>('/api/admin/settings'),
  updateSettings: (payload: Record<string, string | number>) => request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) }),
}
