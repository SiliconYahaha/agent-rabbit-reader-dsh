'use strict'
const { readerPage } = require('./reader-host')
const { createHash } = require('node:crypto')
const sources = () => [...require('../fixtures/cdr-record-integrity/before.json').rows, ...require('../fixtures/cdr-record-integrity/expanded-before.json').cases]
async function capture () {
  let input
  const page = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: input.subarray(o.position || 0, (o.position || 0) + (o.length || input.length)) }) }) })
  const rows = []
  try {
    for (const source of sources()) {
      input = Buffer.from(source.base64, 'base64')
      if (createHash('sha256').update(input).digest('hex') !== source.sha256) throw Error(source.name + ' original source mismatch')
      page.openSelectedFile({ name: source.name + '.cdr', path: '/fixture/input.cdr', size: input.length })
      for (let i = 0; i < 4; i++) await new Promise(setImmediate)
      rows.push({ name: source.name, sourceSha256: source.sha256, category: source.category, summary: page.data.inspectorSummary, loading: page.data.isLoading, error: page.data.error, source: page.data.inspectorPreviewSource, svg: page.data.inspectorPreviewSource ? Buffer.from(page.data.inspectorPreviewSource.split(',')[1], 'base64').toString() : '' })
    }
  } finally { page.detached() }
  return rows
}
module.exports = { sources, capture }
