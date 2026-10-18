'use strict'

const files = require('./data/files')
const { clockSource } = require('./clock-source')
const clockTemplate = require('./data/clock-template')
const cards = files.map(({ base64, ...card }) => card)

// Bundled bytes are written under an owned, bounded namespace. No user file is overwritten.
function materialize (id, host) {
  const file = files.find(item => item.id === id)
  if (!file) return Promise.reject(new Error('示例不存在，请返回重选。'))
  if (!host.env || !host.env.USER_DATA_PATH) return Promise.reject(new Error('存储暂不可用，请重试。'))
  if (file.compressedPath) return materializeCompressed(file, host)
  const content = file.id === 'clock' ? clockSource(clockTemplate) : null
  const path = `${host.env.USER_DATA_PATH}/rabbit-example-${file.id === 'final' ? 'v4' : ['change', 'clock', 'bicycle'].includes(file.id) ? 'v3' : 'v1'}-${file.id}.${file.name.split('.').pop()}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('示例准备超时，请重试。')), 10000)
    try { host.getFileSystemManager().writeFile({
      filePath: path,
      data: content || file.base64,
      encoding: content ? 'utf8' : 'base64',
      success: () => { clearTimeout(timer); resolve({ name: file.name, path, size: file.size, type: file.type }) },
      fail: error => { clearTimeout(timer); reject(new Error(String(error && error.errMsg || '示例准备失败'))) }
    }) } catch (error) { clearTimeout(timer); reject(error) }
  })
}

async function materializeCompressed (file, host) {
  const fs = host.getFileSystemManager()
  if (typeof fs.readCompressedFile !== 'function') throw new Error('请更新微信后再打开此示例。')
  const prepare = async () => {
    if (file.compressedPath.startsWith('/example-poster/')) {
      if (typeof require.async === 'function') await require.async('../example-poster/index.js')
      else if (typeof process !== 'undefined' && process.versions && process.versions.node) { const entry = '../example-poster/index.js'; require(entry) }
      else throw new Error('请更新微信后再打开此示例。')
    }
    const result = await new Promise((resolve, reject) => fs.readCompressedFile({ filePath: file.compressedPath, compressionAlgorithm: 'br', success: resolve, fail: reject }))
    if (!result.data || result.data.byteLength !== file.size) throw new Error('示例文件不完整，请重新打开。')
    const path = `${host.env.USER_DATA_PATH}/rabbit-example-v3-${file.id}.${file.name.split('.').pop()}`
    await new Promise((resolve, reject) => fs.writeFile({ filePath: path, data: result.data, success: resolve, fail: reject }))
    return { name: file.name, path, size: file.size, type: file.type }
  }
  let timer
  try { return await Promise.race([prepare(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('示例准备超时，请重试。')), 20000) })]) }
  finally { clearTimeout(timer) }
}

module.exports = { cards, materialize }
