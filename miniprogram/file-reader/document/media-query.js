'use strict'

function normalizeEnvironment (environment = {}) {
  return {
    viewportHeight: Number(environment.viewportHeight) > 0 ? Number(environment.viewportHeight) : 667,
    colorScheme: String(environment.colorScheme || 'light').toLowerCase() === 'dark' ? 'dark' : 'light',
    reducedMotion: String(environment.reducedMotion || 'no-preference').toLowerCase() === 'reduce' ? 'reduce' : 'no-preference',
    pointer: /^(none|fine|coarse)$/.test(environment.pointer) ? environment.pointer : 'coarse',
    hover: environment.hover === 'hover' ? 'hover' : 'none'
  }
}

function mediaQueryPartMatches (part, viewportWidth, environment) {
  let value = String(part || '').trim().toLowerCase()
  if (!value) return false

  const negated = /^not\b/.test(value)
  value = value.replace(/^not\b\s*/, '').replace(/^only\b\s*/, '')
  let recognized = false
  let matches = true

  const mediaType = value.match(/^(all|screen|print)\b/)
  if (mediaType) {
    recognized = true
    if (mediaType[1] === 'print') matches = false
  } else if (/\bprint\b/.test(value) && !/\b(?:screen|all)\b/.test(value)) {
    recognized = true
    matches = false
  }

  const maximums = Array.from(value.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/g), match => Number(match[1]))
  const minimums = Array.from(value.matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/g), match => Number(match[1]))
  if (maximums.length || minimums.length) recognized = true
  if (maximums.some(maximum => viewportWidth > maximum)) matches = false
  if (minimums.some(minimum => viewportWidth < minimum)) matches = false

  const orientations = Array.from(value.matchAll(/orientation\s*:\s*(portrait|landscape)/g), match => match[1])
  if (orientations.length) {
    recognized = true
    const orientation = viewportWidth > environment.viewportHeight ? 'landscape' : 'portrait'
    if (orientations.some(item => item !== orientation)) matches = false
  }

  const schemes = Array.from(value.matchAll(/prefers-color-scheme\s*:\s*(light|dark)/g), match => match[1])
  if (schemes.length) {
    recognized = true
    if (schemes.some(scheme => scheme !== environment.colorScheme)) matches = false
  }

  const motionPreferences = Array.from(value.matchAll(/prefers-reduced-motion\s*:\s*(reduce|no-preference)/g), match => match[1])
  if (motionPreferences.length) {
    recognized = true
    if (motionPreferences.some(preference => preference !== environment.reducedMotion)) matches = false
  }

  // The reader's host is touch-first. Expose the same input capabilities to
  // CSS and matchMedia, otherwise mobile-only controls never become visible.
  for (const feature of value.matchAll(/\(\s*(?:any-)?(pointer|hover)\s*:\s*(none|fine|coarse|hover)\s*\)/g)) {
    recognized = true
    if (feature[2] !== environment[feature[1]]) matches = false
  }

  const result = recognized && matches
  return negated ? !result : result
}

function mediaQueryMatches (query, viewportWidth, options = {}) {
  const width = Number.isFinite(Number(viewportWidth)) ? Number(viewportWidth) : 375
  const environment = normalizeEnvironment(options)
  return String(query || '').split(',').some(part => mediaQueryPartMatches(part, width, environment))
}

module.exports = { mediaQueryMatches, normalizeEnvironment }
