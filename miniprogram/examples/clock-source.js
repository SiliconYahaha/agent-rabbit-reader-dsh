'use strict'
// Seed the SVG's standard SMIL wallclock anchor with the device's local midnight.
// The renderer samples absolute time, so loading delays and resuming do not drift.
function clockSource (source, now = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  const offset = -now.getTimezoneOffset(), abs = Math.abs(offset)
  const midnight = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00:00${offset >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return source.replace(/wallclock\(2026-01-01T00:00:00\+00:00\)/g, `wallclock(${midnight})`)
}
module.exports = { clockSource }
