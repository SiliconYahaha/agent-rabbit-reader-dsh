'use strict'
const { zlibSync } = require('./vendor/fflate')
const { crc32 } = require('./kernel').archiveMembers
function concat (parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}
function chunk (name, data) {
  const output = new Uint8Array(data.length + 12), view = new DataView(output.buffer)
  view.setUint32(0, data.length)
  output.set(Array.from(name, ch => ch.charCodeAt(0)), 4)
  output.set(data, 8)
  view.setUint32(data.length + 8, crc32(output.subarray(4, data.length + 8)))
  return output
}
// Some hosts expose 2D getImageData but no synchronous Canvas.toDataURL.
// Encode the actual RGBA pixels, never a placeholder PNG or screenshot of UI.
function encodeCanvasPng (canvas) {
  const width = Number(canvas.width), height = Number(canvas.height)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 16 * 1024 * 1024) throw new Error('Canvas 导出尺寸超过安全范围')
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
  if (!pixels || pixels.length !== width * height * 4) throw new Error('Canvas 像素数据不完整')
  const stride = width * 4, raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))])
}
module.exports = { encodeCanvasPng }
