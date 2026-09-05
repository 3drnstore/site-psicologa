// Compatibilidade: este enhancer legado não deve mais reescrever a grade moderna da agenda.
// A grade atual é controlada por admin-calendar-enhancer.ts, que preserva horário,
// estado da sessão e o link de contato do paciente.
export function installAdminAppointmentEnhancer(){
  // Mantido apenas para compatibilidade com o import existente em main.tsx.
}
