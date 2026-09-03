// Temporariamente desativado: este enhancer manipulava nós controlados pelo React
// e podia causar falha de reconciliação logo após o login do paciente.
// As funções essenciais do portal permanecem no PatientView nativo.
export function installPatientPortalEnhancer() {}
