'use strict'

// DevTools 2.02.2608070 returns the left-hand node for `>>>`, instead of
// crossing custom-component boundaries. Traverse those boundaries explicitly
// through official Element queries; returned handles still perform real taps,
// text/style reads and native control operations.
const MARKER = Symbol.for('html-reader.automator.deep-query')

async function descendants (scope, selector, query, visited = new Set()) {
  const matches = await query(scope, selector)
  for (const component of await query(scope, 'component')) {
    const key = `${component.pageId}:${component.id}`
    if (visited.has(key)) continue
    visited.add(key)
    matches.push(...await descendants(component, selector, query, visited))
  }
  return matches
}

async function deepQueryAll (scope, selector, query) {
  const parts = selector.split(/\s*>>>\s*/)
  if (parts.some(part => !part)) throw new Error(`Invalid deep selector: ${selector}`)
  let matches = await query(scope, parts[0])
  for (const part of parts.slice(1)) {
    const next = []
    for (const match of matches) next.push(...await descendants(match, part, query))
    matches = next
  }
  const seen = new Set()
  return matches.filter(element => {
    const key = `${element.pageId}:${element.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function installAutomatorQueryCompatibility (PageClass) {
  const Page = PageClass || require('miniprogram-automator/out/Page').default
  const prototype = Page.prototype
  if (prototype[MARKER]) return false
  const originalAll = prototype.$$, originalOne = prototype.$
  Object.defineProperty(prototype, MARKER, { value: true })
  const query = (scope, selector) => scope instanceof Page ? originalAll.call(scope, selector) : scope.$$(selector)
  prototype.$$ = function (selector) {
    return selector.includes('>>>') ? deepQueryAll(this, selector, query) : originalAll.call(this, selector)
  }
  prototype.$ = async function (selector) {
    return selector.includes('>>>') ? (await this.$$(selector))[0] || null : originalOne.call(this, selector)
  }
  return true
}

module.exports = { deepQueryAll, installAutomatorQueryCompatibility }
