export type ApiError = { message?: string }

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({})) as T & ApiError
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a solicitação.')
  return data
}

async function sessionRequest<T>(path:string):Promise<T>{
  let lastError:unknown
  for(let attempt=0;attempt<3;attempt++){
    try{return await request<T>(path)}
    catch(error){lastError=error;if(attempt<2)await sleep(180)}
  }
  throw lastError instanceof Error?lastError:new Error('Não foi possível restaurar a sessão.')
}

async function loginAndWait<T>(path:string,payload:Record<string,string>,sessionPath:string){
  const result=await request<T>(path,{method:'POST',body:JSON.stringify(payload)})
  await sleep(220)
  await sessionRequest(sessionPath)
  return result
}

export const api = {
  health: () => request<{ ok: boolean; database: string }>('/api/health'),
  register: (payload: Record<string, string>) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  completeGoogle: (payload: Record<string, string>) => request('/api/auth/google/complete', { method: 'POST', body: JSON.stringify(payload) }),
  login: (email: string, password: string) => loginAndWait('/api/auth/login',{email,password},'/api/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => sessionRequest<any>('/api/me'),
  availability: (from?: string, to?: string) => request<any>(`/api/availability?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`),
  reserve: (slotId: string | number) => request<any>('/api/appointments/reserve', { method: 'POST', body: JSON.stringify({ slot_id: slotId }) }),
  myAppointments: () => request<any>('/api/appointments/mine').catch(() => ({ ok: true, appointments: [] })),
  cancelAppointment: (appointmentId: string | number) => request(`/api/appointments/${appointmentId}/cancel`, { method: 'POST' }),
  checkout: (appointmentId: string | number, method: 'pix' | 'card') => request<any>('/api/payments/checkout', { method: 'POST', body: JSON.stringify({ appointment_id: appointmentId, method }) }),
  adminLogin: (email: string, password: string) => loginAndWait('/api/admin/login',{email,password},'/api/admin/me'),
  adminLogout: () => request('/api/admin/logout', { method: 'POST' }),
  adminMe: () => sessionRequest<any>('/api/admin/me'),
  adminPatients: () => request<any>('/api/admin/patients').catch(() => ({ ok: true, patients: [] })),
  adminPatient: (id: string | number) => request<any>(`/api/admin/patients/${encodeURIComponent(String(id))}`),
  saveClinicalNote: (patientId: string | number, payload: { appointment_id?: string | number; session_date: string; note_text: string }) => request(`/api/admin/patients/${encodeURIComponent(String(patientId))}/notes`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteClinicalNote: (id: string) => request(`/api/admin/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminAppointments: () => request<any>('/api/admin/appointments').catch(() => ({ ok: true, appointments: [] })),
  setAppointmentStatus: (id: string | number, status: 'confirmed' | 'cancelled', reason?: string) => request(`/api/admin/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }),
  createSlot: (payload: { starts_at: string; ends_at: string }) => request('/api/admin/availability', { method: 'POST', body: JSON.stringify(payload) }),
  adminAvailability: (from?: string, to?: string) => request<any>(`/api/admin/availability-v2?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`).catch(() => ({ ok: true, slots: [], recurring_blocks: [] })),
  setSlotMode: (slotId: string | number, mode: 'free' | 'blocked' | 'hidden' | 'visible') => request(`/api/admin/availability/${encodeURIComponent(String(slotId))}/mode`, { method: 'PATCH', body: JSON.stringify({ mode }) }),
  deleteSlot: (slotId: string | number) => request(`/api/admin/availability/${encodeURIComponent(String(slotId))}`, { method: 'DELETE' }),
  createRecurringBlock: (payload: { weekdays: number[]; start_time: string; end_time: string; date_from?: string; date_to?: string; label?: string }) => request<any>('/api/admin/recurring-blocks', { method: 'POST', body: JSON.stringify(payload) }),
  setRecurringBlockActive: (id: string, active: boolean) => request(`/api/admin/recurring-blocks/${encodeURIComponent(id))}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  settings: () => request<any>('/api/admin/settings').catch(() => ({ ok: true, settings: {} })),
  updateSettings: (payload: Record<string, string | number>) => request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) }),
}
