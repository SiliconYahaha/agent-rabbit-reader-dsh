'use strict'
// Real local files -> production reader entry -> generated DOM render tree.
// Compare its Chrome-visible paragraph with Chrome decoding the original bytes.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { chromeTestResult } = require('./chrome-test-result')
const output = path.resolve(process.argv[2] || 'outputs/html-entry-size/views')
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const serialize = node => node.type === 'text' ? escape(node.text) : `<${node.name} ${Object.entries(node.attrs || {}).filter(([key]) => !key.startsWith('data-hr-')).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}>${(node.children || []).map(serialize).join('')}</${node.name}>`
const expected = 'BEGIN 中文 😀 END'
const source = '<!doctype html><meta charset="utf-8"><body style="margin:0"><p id="probe">' + expected + '</p></body>'
const encodings = {
  utf8: Buffer.from(source),
  utf16le: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')]),
  utf16be: Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(source, 'utf16le').swap16()])
}
const localFs = {
  stat: options => fs.stat(options.path, (error, stats) => error ? options.fail(error) : options.success({ stats })),
  readFile: options => fs.readFile(options.filePath, (error, data) => error ? options.fail(error) : options.success({ data }))
}

async function main () {
  fs.mkdirSync(output, { recursive: true })
  const actualLimits = []
  const largePath = path.join(output, 'actual-large.html')
  // A sparse local file validates native stat without allocating its contents.
  const fd = fs.openSync(largePath, 'w')
  try { fs.ftruncateSync(fd, 20 * 1024 * 1024 + 1) } finally { fs.closeSync(fd) }
  for (const filePath of [largePath, path.join(output, 'not-created.html')]) {
    let reads = 0
    const page = readerPage({ getFileSystemManager: () => ({ ...localFs, readFile: () => { reads++ } }) })
    try {
      page.openSelectedFile({ name: 'limit.html', path: filePath, size: 1 })
      const deadline = Date.now() + 10000
      while (page.data.isLoading && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(page.data.isLoading, false)
      assert.equal(reads, 0)
      assert.match(page.data.error, filePath === largePath ? /安全上限/ : /ENOENT/)
      actualLimits.push({ case: filePath === largePath ? 'actual-over20MB' : 'missing-file-stat', hint: 1, reads, error: filePath === largePath ? 'actual size exceeds limit' : 'native stat ENOENT' })
    } finally { page.detached() }
  }
  const views = []
  for (const [encoding, bytes] of Object.entries(encodings)) {
    const file = path.join(output, encoding + '.html')
    fs.writeFileSync(file, bytes)
    for (const hint of [0, 1, bytes.length, 20 * 1024 * 1024 + 1, 200 * 1024 * 1024 + 1]) {
      const page = readerPage({ getFileSystemManager: () => localFs })
      try {
        page.openSelectedFile({ name: encoding + '.html', path: file, size: hint })
        const deadline = Date.now() + 10000
        while (page.data.isLoading && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
        assert.equal(page.data.isLoading, false)
        assert.equal(page.data.error, '', encoding + '/' + hint)
        assert.equal(page._htmlRuntime.document.getElementById('probe').textContent, expected)
        const runtime = page._htmlRuntime
        const tree = renderHtmlDomTree(runtime.document, { styles: runtime.renderState().styles, viewportWidth: 390 })
        const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;' + escape(tree.wrapperStyle) + '">' + tree.nodes.map(serialize).join('') + '</body>'
        views.push({ encoding, hint, actualBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), html, bytes })
      } finally { page.detached() }
    }
  }
  async function runner (count) {
    const frames = [...document.querySelectorAll('iframe')], results = []
    for (let index = 0; index < count; index++) {
      await Promise.all(frames.map((frame, side) => new Promise(resolve => { frame.onload = resolve; frame.src = '/' + (side ? 'reader' : 'original') + '/' + index })))
      results.push({ original: frames[0].contentDocument.querySelector('#probe').innerText, reader: frames[1].contentDocument.querySelector('#probe').innerText })
    }
    document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify(results)))
  }
  const dashboard = '<!doctype html><output></output><iframe style="width:390px"></iframe><iframe style="width:390px"></iframe><script>(' + runner + ')(' + views.length + ').catch(error=>document.querySelector("output").setAttribute("data-error",error.message))</script>'
  const server = http.createServer((request, response) => {
    const match = request.url.match(/^\/(original|reader)\/(\d+)$/)
    response.setHeader('Content-Type', 'text/html')
    if (!match) return response.end(dashboard)
    const view = views[Number(match[2])]
    response.end(match[1] === 'original' ? view.bytes : view.html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let dumped
  try { dumped = await chromeTestResult('http://127.0.0.1:' + server.address().port + '/') } finally { server.close() }
  const encoded = dumped.match(/data-result="([^"]+)"/)
  assert.ok(encoded, 'Chrome result missing: ' + dumped.slice(-2000))
  const result = JSON.parse(decodeURIComponent(encoded[1]))
  assert.equal(result.length, views.length)
  result.forEach((row, index) => {
    assert.equal(row.original, expected, 'native byte decoding ' + index)
    assert.equal(row.reader, row.original, 'production entry/rendering ' + index)
  })
  const report = { scope: 'Local Node filesystem stat/read and actual reader entry, then Chrome original bytes vs reconstructed render tree. Not WeChat native filesystem or WXML.', seed: null, rules: 'UTF-8/UTF-16LE/UTF-16BE BOM x unknown/small/actual/over20MB/over200MB metadata', expected, actualLimits, cases: views.map(({ html, bytes, ...view }, index) => ({ ...view, ...result[index] })), passed: result.length, wechat: 'blocked-login', devices: 'not-run' }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, output }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
