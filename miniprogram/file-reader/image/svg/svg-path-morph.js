'use strict'

// Keep command types for animation compatibility; rasterization's M/L/C/Z
// normalization would incorrectly allow H↔L or Q↔C morphing.
const { parsePathData: parseMorphPath } = require('./svg-path-data')

function classifyPathValue (source, allowPrefix = false) {
  const value = parseMorphPath(source, allowPrefix)
  return value ? { kind: 'path', value } : { kind: 'invalid-path', value: '' }
}

function interpolatePath (from, to, time) {
  const a = from.value, b = to.value
  if (a.length !== b.length || a.some((command, i) => command.type !== b[i].type)) return time < 0.5 ? from : to
  return { kind: 'path', value: a.map((command, i) => ({
    type: command.type,
    args: command.args.map((value, j) => {
      // Chrome SMIL switches arc flags at the midpoint. Record this difference
      // from SVG 2's non-zero fractional-flag wording in the oracle report.
      if (command.type === 'A' && (j === 3 || j === 4)) return time < 0.5 ? value : b[i].args[j]
      return value * (1 - time) + b[i].args[j] * time
    })
  })) }
}

function serializePath (commands) {
  return commands.map(command => command.type + command.args.join(' ')).join(' ')
}
module.exports = { classifyPathValue, interpolatePath, parseMorphPath, serializePath }
