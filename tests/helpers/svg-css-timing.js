'use strict'

// Authored deterministic originals, not the unavailable qin-bear user file.
function cases () {
  const rows = []
  const frames = '0%{fill-opacity:0}25%{fill-opacity:1}75%{fill-opacity:0.2}100%{fill-opacity:0.8}'
  for (const easing of ['linear', 'ease', 'ease-in-out', 'steps(4,start)', 'steps(4,end)', 'steps(4,jump-none)', 'steps(4,jump-both)', 'step-start', 'step-end']) {
    for (const direction of ['normal', 'reverse', 'alternate', 'alternate-reverse']) {
      rows.push({ id: `${easing}-${direction}`, easing, direction, delay: 0.5, iterations: 2, frames })
    }
  }
  rows.push({ id: 'per-keyframe-easing', easing: 'ease', direction: 'normal', delay: 0, iterations: 1, frames: '0%{fill-opacity:0;animation-timing-function:steps(2,start)}50%{fill-opacity:1;animation-timing-function:linear}100%{fill-opacity:0;animation-timing-function:step-end}' })
  rows.push({ id: 'fractional-reverse', easing: 'ease', direction: 'reverse', delay: -0.5, iterations: 1.25, frames })
  rows.push({ id: 'implicit-endpoints', easing: 'ease', direction: 'normal', delay: 0, iterations: 1, frames: '25%{fill-opacity:1}75%{fill-opacity:0}' })
  rows.push({ id: 'property-specific-intervals', easing: 'ease-in', direction: 'normal', delay: 0, iterations: 1, frames: '0%{fill-opacity:0;stroke-opacity:1}25%{stroke-opacity:0}75%{fill-opacity:1}100%{fill-opacity:0;stroke-opacity:1}' })
  rows.push({ id: 'duplicate-keyframe-easing', easing: 'linear', direction: 'normal', delay: 0, iterations: 1, frames: 'from{fill-opacity:0;animation-timing-function:step-start}from{fill-opacity:0.2}50%{fill-opacity:1}100%{fill-opacity:0}' })
  rows.push({ id: 'duplicate-middle-easing', easing: 'linear', direction: 'alternate', delay: 0, iterations: 2, frames: 'from{fill-opacity:0}50%{animation-timing-function:steps(2,end)}50%{fill-opacity:1}to{fill-opacity:0.2}' })
  for (const invalid of ['steps(0,start)', 'steps(1,jump-none)', 'steps(4,jump-missing)', 'cubic-bezier(2,0,0,1)']) rows.push({ id: 'invalid-keyframe-' + invalid, easing: 'linear', direction: 'normal', delay: 0, iterations: 1, frames: `from{fill-opacity:0;animation-timing-function:${invalid}}to{fill-opacity:1}` })
  rows.push({ id: 'signed-step-count', easing: 'steps( +4 , jump-start )', direction: 'normal', delay: 0, iterations: 1, frames: 'from{fill-opacity:0}to{fill-opacity:1}' })
  return rows.map(row => ({ ...row, times: [...new Set([0, 0.499, 0.5, 0.501, 0.75, 1, 1.5, 2, 2.499, 2.5, 2.75, 3, 3.5, 4, 4.499, 4.5, 5])], source: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><style>#subject{animation:pulse 2s ${row.easing} ${row.delay}s ${row.iterations} ${row.direction} both}@keyframes pulse{${row.frames}}</style><rect id="subject" x="8" y="8" width="48" height="48" fill="#4488cc" fill-opacity="0.4"/></svg>` }))
}
module.exports = { cases }
