'use strict'
const fs = require('node:fs')
const assert = require('node:assert/strict')
// The automator screenshot RPC calls wx.saveFile and accumulates persistent
// simulator storage. Export the already-tested Canvas without writing WX files.
async function saveSvgCanvasSnapshot (mini, destination) {
  const dataURL = await mini.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0], reader = page && page.selectComponent('#reader')
    const view = reader && reader.selectComponent('#standalone-svg-player')
    if (!view || !view._canvas || typeof view._canvas.toDataURL !== 'function') return null
    return view._canvas.toDataURL('image/png')
  })
  assert.ok(typeof dataURL === 'string' && dataURL.startsWith('data:image/png;base64,'), 'Canvas PNG export unavailable')
  const bytes = Buffer.from(dataURL.slice('data:image/png;base64,'.length), 'base64')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Canvas PNG header')
  fs.writeFileSync(destination, bytes)
}
module.exports = { saveSvgCanvasSnapshot }
