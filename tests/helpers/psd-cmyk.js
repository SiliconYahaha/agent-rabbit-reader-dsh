'use strict'
const { psdAlphaFixture } = require('./psd-alpha')
function cases () {
  const result = require('../../compatibility/runs/2026-09-05-next-psd-cmyk.json').results.map(r => ({ name: 'original-' + r.name, bytes: Buffer.from(r.hex, 'hex'), depth: r.depth, group: 'original' }))
  const resource = Buffer.alloc(20); resource.write('8BIM'); resource.writeUInt16BE(1053, 4); resource.writeUInt32BE(8, 8); resource.writeUInt32BE(17, 16)
  for (const version of [1, 2]) for (const depth of [8, 16]) for (const compression of [0, 1, 2, 3]) for (const kind of ['opaque', 'alpha', 'spot', 'resource-spot']) {
    const max = depth === 16 ? 65535 : 255
    const colors = Array.from({ length: 4 }, (_, channel) => Array.from({ length: 131 * 3 }, (_, i) => ((i * (61 + channel * 18) + channel * 29 + 17) % (max + 1)) / max))
    const opts = { version, depth, compression, mode: 4, width: 131, height: 3, colors, alpha: [0, .02, .25, .5, .75, .98, 1], extraChannel: kind !== 'opaque', flag: kind === 'opaque' ? 'none' : kind === 'resource-spot' ? (depth === 16 ? 'Mt16' : 'Mtrn') : 'count', trailingSpot: kind.endsWith('spot'), resources: kind === 'resource-spot' ? resource : Buffer.alloc(0) }
    result.push({ name: `${kind}-v${version}-${depth}-c${compression}.${version === 2 ? 'psb' : 'psd'}`, bytes: psdAlphaFixture(opts), depth, group: kind })
  }
  for (const depth of [8, 16]) for (const colors of [[.1,.2,.3,.4],[.37,.63,.81,.23],[0,.5,1,0],[0,.5,1,1]]) result.push({ name: `precision-${depth}-${colors.join('_')}.psd`, bytes: psdAlphaFixture({ depth, mode: 4, extraChannel: false, flag: 'none', width: 5, height: 3, colors }), depth, group: 'precision' })
  return result
}
module.exports = { cases }
