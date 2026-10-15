'use strict'

// ICC.1 v2/v4 RGB matrix/TRC -> D50 PCS -> sRGB, media-relative colorimetric.
// LUT/device-link/float profiles require a different pipeline; never apply a
// convenient matrix while silently ignoring their color transform.
function parseRgbIccProfile (bytes) {
  try {
    if (bytes.length < 132) return { status: 'invalid' }
    if (bytes.length > 4 * 1024 * 1024) return { status: 'unsupported' }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const text = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const size = view.getUint32(0, false), count = view.getUint32(128, false)
    if (size < 132 || size > bytes.length || text(36) !== 'acsp' || count > (size - 132) / 12) return { status: 'invalid' }
    if (![2, 4].includes(bytes[8]) || !['mntr', 'scnr'].includes(text(12)) || text(16) !== 'RGB ' || text(20) !== 'XYZ ' || count > 1024) return { status: 'unsupported' }
    const tags = new Map(), ranges = []
    for (let i = 0; i < count; i++) {
      const entry = 132 + i * 12, signature = text(entry), offset = view.getUint32(entry + 4, false), length = view.getUint32(entry + 8, false)
      if (tags.has(signature) || offset % 4 || offset < 132 + count * 12 || length < 8 || offset + length > size) return { status: 'invalid' }
      tags.set(signature, { offset, length }); ranges.push({ offset, length })
    }
    ranges.sort((a, b) => a.offset - b.offset || a.length - b.length)
    for (let i = 1; i < ranges.length; i++) {
      const a = ranges[i - 1], b = ranges[i]
      if (b.offset < a.offset + a.length && (a.offset !== b.offset || a.length !== b.length)) return { status: 'invalid' }
    }
    if ([...tags.keys()].some(key => /^(A2B|D2B)/.test(key))) return { status: 'unsupported' }
    const fixed = offset => view.getInt32(offset, false) / 65536
    function xyz (name) {
      const tag = tags.get(name)
      if (!tag || tag.length < 20 || text(tag.offset) !== 'XYZ ') throw Error('Invalid XYZ')
      return [8, 12, 16].map(n => fixed(tag.offset + n))
    }
    function curve (name) {
      const tag = tags.get(name)
      if (!tag || tag.length < 12) throw Error('Missing curve')
      const offset = tag.offset, type = text(offset)
      if (type === 'curv') {
        const n = view.getUint32(offset + 8, false)
        if (n > 65536 || 12 + n * 2 > tag.length) throw Error('Curve bounds')
        if (!n) return x => x
        if (n === 1) {
          const gamma = view.getUint16(offset + 12, false) / 256
          if (gamma <= 0) throw Error('Curve gamma')
          return x => Math.pow(x, gamma)
        }
        const values = Array.from({ length: n }, (_, i) => view.getUint16(offset + 12 + i * 2, false) / 65535)
        if (values.some((value, i) => i && value < values[i - 1])) throw Error('Nonmonotonic curve')
        return x => { const index = x * (n - 1), low = Math.min(n - 2, Math.floor(index)); return values[low] + (values[low + 1] - values[low]) * (index - low) }
      }
      if (type !== 'para') throw Error('Unsupported curve')
      const kind = view.getUint16(offset + 8, false), lengths = [1, 3, 4, 5, 7]
      if (kind > 4 || 12 + lengths[kind] * 4 > tag.length) throw Error('Parameter bounds')
      const [g, a, b, c, d, e, f] = Array.from({ length: lengths[kind] }, (_, i) => fixed(offset + 12 + i * 4))
      if (g <= 0 || (kind > 0 && a <= 0) || (kind >= 3 && (d < -b / a || c < 0))) throw Error('Invalid parameters')
      const fn = kind === 0 ? x => Math.pow(x, g)
        : kind === 1 ? x => x >= -b / a ? Math.pow(a * x + b, g) : 0
          : kind === 2 ? x => x >= -b / a ? Math.pow(a * x + b, g) + c : c
            : kind === 3 ? x => x >= d ? Math.pow(a * x + b, g) : c * x
              : x => x >= d ? Math.pow(a * x + b, g) + e : c * x + f
      if (![0, 1, ...(kind >= 3 ? [Math.max(0, Math.min(1, d))] : [])].every(x => Number.isFinite(fn(x)))) throw Error('Invalid curve domain')
      return fn
    }
    const white = xyz('wtpt'), d50 = [.9642, 1, .8249]
    // Legacy v2 profiles with non-D50 media white need a separate adaptation
    // policy; don't treat their colorants as this D50 computational model.
    if (white.some((v, i) => Math.abs(v - d50[i]) > .0001) || d50.some((v, i) => Math.abs(fixed(68 + i * 4) - v) > .0001)) return { status: 'unsupported' }
    const columns = ['rXYZ', 'gXYZ', 'bXYZ'].map(xyz), curves = ['rTRC', 'gTRC', 'bTRC'].map(curve)
    const [r, g, b] = columns
    const determinant = r[0] * (g[1] * b[2] - g[2] * b[1]) - g[0] * (r[1] * b[2] - r[2] * b[1]) + b[0] * (r[1] * g[2] - r[2] * g[1])
    if (Math.abs(determinant) < 1e-12) return { status: 'invalid' }
    // The source colorants are already adapted to the D50 PCS: do not apply
    // its chad tag a second time. Inverse of sRGB primaries adapted with Bradford
    // from D65 xy(.3127,.329) to ICC D50 XYZ(.9642,1,.8249), at full precision.
    const toSrgb = [[3.134186364236821, -1.617208958998276, -.4906940640063844], [-.978748504190695, 1.916130096773587, .0334333991599956], [.0719639278022468, -.2289938734532033, 1.405753732896445]]
    const matrix = toSrgb.map(row => columns.map(column => row.reduce((sum, v, i) => sum + v * column[i], 0)))
    const byte = x => { const v = Math.max(0, Math.min(1, x)); return Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055)) }
    return { status: 'applied', transform (r, g, b) {
      const red = curves[0](Math.max(0, Math.min(1, r)))
      const green = curves[1](Math.max(0, Math.min(1, g)))
      const blue = curves[2](Math.max(0, Math.min(1, b)))
      return [
        byte(matrix[0][0] * red + matrix[0][1] * green + matrix[0][2] * blue),
        byte(matrix[1][0] * red + matrix[1][1] * green + matrix[1][2] * blue),
        byte(matrix[2][0] * red + matrix[2][1] * green + matrix[2][2] * blue)
      ]
    } }
  } catch (_) { return { status: 'invalid' } }
}

module.exports = { parseRgbIccProfile }
