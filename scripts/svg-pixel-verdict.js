'use strict'

// Both references are required: a hand-built reference can accidentally repeat
// a renderer bug. A matching reference alone must never conceal native SVG drift.
function svgPixelFailures (results) {
  return results.filter(row => row.variants.some(variant => variant.error) ||
    row.variants[0].rgbaError !== 0 || row.variants[0].svgRGBAError !== 0 ||
    row.variants[0].boundsError > 1e-4 || row.variants[2].fallbackError !== 0)
}

module.exports = { svgPixelFailures }
