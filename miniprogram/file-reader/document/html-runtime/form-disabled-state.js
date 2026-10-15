'use strict'

// Attribute reflection, form-control activation and CSS disabled matching are
// distinct HTML concepts. Derive ancestry live so moving a legend/control or
// toggling a fieldset cannot leave cached disabled state behind.
function htmlElement (element, names) {
  return Boolean(element && element.nodeType === 1 && (element.namespaceURI === 'http://www.w3.org/1999/xhtml' || element.namespaceURI == null && !element.ownerDocument._xmlMode) && names.includes(element.localName))
}
function disabledByFieldset (element) {
  let branch = element
  for (let ancestor = element.parentNode; ancestor; branch = ancestor, ancestor = ancestor.parentNode) {
    if (!htmlElement(ancestor, ['fieldset']) || !ancestor.hasAttribute('disabled')) continue
    if (!htmlElement(branch, ['legend']) || ancestor.children.find(child => htmlElement(child, ['legend'])) !== branch) return true
  }
  return false
}
function disabledControl (element) {
  return htmlElement(element, ['button', 'input', 'select', 'textarea']) && (element.hasAttribute('disabled') || disabledByFieldset(element))
}
function disabledOption (element) {
  if (!htmlElement(element, ['option'])) return false
  if (element.hasAttribute('disabled')) return true
  for (let ancestor = element.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (htmlElement(ancestor, ['select', 'hr', 'datalist', 'option'])) return false
    if (htmlElement(ancestor, ['optgroup'])) return ancestor.hasAttribute('disabled')
  }
  return false
}
function nearestSelect (element) {
  let group = false
  for (let ancestor = element.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (htmlElement(ancestor, ['datalist', 'hr', 'option'])) return null
    if (htmlElement(ancestor, ['optgroup'])) { if (group) return null; group = true }
    if (htmlElement(ancestor, ['select'])) return ancestor
  }
  return null
}
function supportsDisabled (element) { return htmlElement(element, ['button', 'fieldset', 'input', 'optgroup', 'option', 'select', 'textarea']) }
function actuallyDisabled (element) {
  if (!supportsDisabled(element)) return false
  if (htmlElement(element, ['fieldset'])) return element.hasAttribute('disabled') || disabledByFieldset(element)
  if (htmlElement(element, ['option', 'optgroup'])) {
    return (element.localName === 'option' ? disabledOption(element) : element.hasAttribute('disabled')) || disabledControl(nearestSelect(element))
  }
  return disabledControl(element)
}
function disabledClick (element) {
  return disabledControl(element) || disabledOption(element) || htmlElement(element, ['optgroup']) && element.hasAttribute('disabled')
}
module.exports = { actuallyDisabled, disabledClick, disabledControl, disabledOption, supportsDisabled }
