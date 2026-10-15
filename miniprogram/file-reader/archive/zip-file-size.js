'use strict'

// Picker/share metadata is only a hint. Native stat is authoritative for ZIP
// tail and central-directory ranges; legacy hosts retain bounded hints.
async function zipFileSize (fs, file, maxBytes) {
  const filePath = file.path || file.tempFilePath
  if (!filePath) throw new Error('微信没有返回可读取的 ZIP 路径')
  const size = typeof fs.stat === 'function'
    ? await new Promise((resolve, reject) => fs.stat({ path: filePath, success: result => resolve(result.stats && result.stats.size), fail: reject }))
    : Number(file.size || 0)
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('ZIP 文件大小无效，无法定位中央目录')
  if (size > maxBytes) throw new Error('ZIP 文件超过本机读取安全上限')
  return size
}

module.exports = { zipFileSize }
