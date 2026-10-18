'use strict'
// Read-only Feishu Base snapshot. Decode locally; never fetch attachment URLs
// or execute content. Bound both compressed input and streamed output.
const { Gunzip, strFromU8 } = require('./vendor/fflate')
const MAX_OUTPUT = 4 * 1024 * 1024
const esc = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function decodeBase64 (text) {
  if (text.length > 1400000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) throw new Error('快照编码不完整或过大')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const out = new Uint8Array(text.length / 4 * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0))
  let bits = 0, count = 0, offset = 0
  for (const char of text) { if (char === '=') break; bits = (bits << 6) | alphabet.indexOf(char); count += 6; if (count >= 8) { count -= 8; out[offset++] = (bits >>> count) & 255 } }
  return out
}
function unpack (encoded) {
  const bytes = decodeBase64(encoded), chunks = []; let size = 0
  if (bytes[0] !== 31 || bytes[1] !== 139) throw new Error('不是有效的 GZIP 快照')
  const unzip = new Gunzip(chunk => { size += chunk.length; if (size > MAX_OUTPUT) throw new Error('快照展开后超过 4 MB'); chunks.push(chunk) })
  for (let i = 0; i < bytes.length; i += 1024) unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length)
  const out = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return strFromU8(out)
}
function cellText (value, field, depth = 0) {
  if (depth > 6 || value == null) return ''
  if (Array.isArray(value)) return value.map(v => cellText(v, field, depth + 1)).join(field.type === 1 ? '' : '、')
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (typeof value.name === 'string') return value.name
    if (typeof value.link === 'string') return value.link
    return '［复杂字段］'
  }
  const option = (field.property?.options || []).find(option => option.id === value)
  return option ? option.name : String(value)
}
function renderSnapshot (source) {
  // Only recognize this envelope, leaving ordinary JSON unchanged.
  if (source.length > 2 * 1024 * 1024 || !/"gzipSnapshot"\s*:/.test(source)) return null
  const envelope = JSON.parse(source)
  if (!envelope || typeof envelope.gzipSnapshot !== 'string') return null
  const snapshots = JSON.parse(unpack(envelope.gzipSnapshot))
  if (!Array.isArray(snapshots) || snapshots.length > 32) throw new Error('不支持的表格快照结构')
  let totalRows = 0, totalCells = 0
  const tables = snapshots.map(snapshot => {
    const schema = snapshot.schema, data = schema?.data, table = data?.table
    if (!table?.fieldMap || !data.recordMap) throw new Error('快照缺少表格字段或记录')
    const view = table.viewMap?.[table.views?.[0]]?.property || {}
    const fields = [...new Set([...(view.fields || []), ...Object.keys(table.fieldMap)])].filter(id => table.fieldMap[id])
    const records = [...new Set([...(view.records || []), ...Object.keys(data.recordMap)])].filter(id => data.recordMap[id])
    totalRows += records.length; totalCells += fields.length * records.length
    if (totalRows > 1000 || fields.length > 64 || totalCells > 16000) throw new Error('表格过大，暂不能完整展开')
    const title = schema.base?.name || '多维表格', name = schema.tableMap?.[table.meta?.id]?.name || table.meta?.name || ''
    return `<h2 style="font-size:20px;margin:0 0 8px">${esc(title)}</h2><p style="font-size:13px;color:#67685d">${esc(name)} · ${records.length} 条记录 · 左右滑动查看</p><div style="overflow-x:auto;width:100%"><table style="border-collapse:collapse;width:${fields.length * 160}px;table-layout:fixed"><thead><tr>${fields.map(id => `<th style="padding:10px;border:1px solid #deded5;background:#edf4d9;white-space:nowrap">${esc(table.fieldMap[id].name)}</th>`).join('')}</tr></thead><tbody>${records.map(id => `<tr>${fields.map(field => `<td style="width:140px;padding:10px;border:1px solid #deded5;white-space:pre-wrap">${esc(cellText(data.recordMap[id][field]?.value, table.fieldMap[field]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  })
  if (!tables.length) throw new Error('快照中没有表格')
  return { html: `<article style="padding:18px;background:#fff;color:#24251f;font-size:14px;line-height:1.6">${tables.join('<hr>')}<p style="font-size:12px;color:#67685d">只读快照；附件显示名称，复杂字段可能无法还原。</p></article>`, rows: totalRows }
}
module.exports = { renderSnapshot, unpack }
