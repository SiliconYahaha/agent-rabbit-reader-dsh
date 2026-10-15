'use strict'

const files = require('./data/files')
const cards = files.map(({ base64, ...card }) => card)

// Bundled bytes are written under an owned, bounded namespace. No user file is overwritten.
function materialize (id, host) {
  const file = files.find(item => item.id === id)
  if (!file) return Promise.reject(new Error('示例不存在，请返回重选。'))
  if (!host.env || !host.env.USER_DATA_PATH) return Promise.reject(new Error('存储暂不可用，请重试。'))
  const path = `${host.env.USER_DATA_PATH}/rabbit-example-v1-${file.id}.${file.name.split('.').pop()}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('示例准备超时，请重试。')), 10000)
    try { host.getFileSystemManager().writeFile({
      filePath: path,
      data: file.base64,
      encoding: 'base64',
      success: () => { clearTimeout(timer); resolve({ name: file.name, path, size: file.size, type: file.type }) },
      fail: error => { clearTimeout(timer); reject(new Error(String(error && error.errMsg || '示例准备失败'))) }
    }) } catch (error) { clearTimeout(timer); reject(error) }
  })
}

module.exports = { cards, materialize }
