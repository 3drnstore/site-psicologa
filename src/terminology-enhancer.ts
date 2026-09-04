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

function processElement(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) nodes.push(current as Text)
  nodes.forEach(node => {
    const parent = node.parentElement
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return
    const next = replaceText(node.data)
    if (next !== node.data) node.data = next
  })

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
  if (document.body) apply()
  else document.addEventListener('DOMContentLoaded', apply, { once: true })

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        const node = mutation.target as Text
        const parent = node.parentElement
        if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue
        const next = replaceText(node.data)
        if (next !== node.data) node.data = next
        continue
      }
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node as Text
          const next = replaceText(text.data)
          if (next !== text.data) text.data = next
        } else if (node instanceof Element) {
          processElement(node)
        }
      })
    }
  })

  const start = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
