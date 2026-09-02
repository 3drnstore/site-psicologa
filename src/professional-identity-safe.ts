let installed = false

const PSYCHOLOGIST_NAME = 'Jacqueline Siqueira'
const PSYCHOLOGIST_CRP = '06/212470'

function applyProfessionalIdentity() {
  const root = document.getElementById('root')
  if (!root) return false

  let changed = false

  root.querySelectorAll<HTMLElement>('strong').forEach(element => {
    if ((element.textContent || '').trim() === 'Nome da Psicóloga') {
      element.textContent = PSYCHOLOGIST_NAME
      changed = true
    }
  })

  root.querySelectorAll<HTMLElement>('small').forEach(element => {
    const text = (element.textContent || '').trim()
    if (text === 'Psicologia • CRP 00/00000') {
      element.textContent = `Psicologia • CRP ${PSYCHOLOGIST_CRP}`
      changed = true
    }
  })

  root.querySelectorAll<HTMLElement>('.professional-crp').forEach(element => {
    if ((element.textContent || '').trim() !== `CRP: ${PSYCHOLOGIST_CRP}`) {
      element.textContent = `CRP: ${PSYCHOLOGIST_CRP}`
      changed = true
    }
  })

  return changed || Boolean(root.querySelector('.site-shell, .auth-page, .patient-page'))
}

export function installProfessionalIdentitySafe() {
  if (installed) return
  installed = true

  let attempts = 0
  const tryApply = () => {
    attempts += 1
    const ready = applyProfessionalIdentity()
    if (ready || attempts >= 20) return
    window.setTimeout(tryApply, 50)
  }

  tryApply()
}
