let installed = false

const replacements: Array<[RegExp, string]> = [
  [/\bCONSULTAS\b/g, 'SESSÕES'],
  [/\bConsulta\b/g, 'Sessão'],
  [/\bConsultas\b/g, 'Sessões'],
  [/\bconsulta\b/g, 'sessão'],
  [/\bconsultas\b/g, 'sessões'],
]

function replaceText(value: string) {
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function canTranslateTextNode(node: Text) {
  const parent = node.parentElement
  if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return false
  const adminButton = parent.closest<HTMLButtonElement>('.admin-sidebar nav button')
  if (adminButton && !adminButton.dataset.adminView) return false
  return true
}

function processTextNode(node: Text) {
  if (!canTranslateTextNode(node)) return
  const next = replaceText(node.data)
  if (next !== node.data) node.data = next
}

function processElement(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) nodes.push(current as Text)
  nodes.forEach(processTextNode)

  if (root instanceof Element) updateAttributes(root)
  root.querySelectorAll?.('*').forEach(element => updateAttributes(element as Element))
}

function updateAttributes(element: Element) {
  for (const attribute of ['aria-label', 'title', 'placeholder']) {
    const value = element.getAttribute(attribute)
    if (!value) continue
    const next = replaceText(value)
    if (next !== value) element.setAttribute(attribute, next)
  }
}

export function installTerminologyEnhancer() {
  if (installed) return
  installed = true

  const apply = () => processElement(document.body)
  const scheduleApply = () => {
    ;[0, 60, 140, 300, 600, 1000].forEach(delay => window.setTimeout(apply, delay))
  }

  if (document.body) scheduleApply()
  else document.addEventListener('DOMContentLoaded', scheduleApply, { once: true })

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        processTextNode(mutation.target as Text)
        continue
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        processElement(mutation.target)
        continue
      }
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) processTextNode(node as Text)
        else if (node instanceof Element) processElement(node)
      })
    }
  })

  const start = () => observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-admin-view', 'aria-label', 'title', 'placeholder'],
  })
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
