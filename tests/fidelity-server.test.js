'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const store = fs.mkdtempSync(path.join(os.tmpdir(), 'html-reader-fidelity-'))
process.env.HTML_READER_STORE = store
process.env.HTML_READER_TTL_MS = '3600000'

const { UPLOAD_LIMIT, createServer, deleteOwnedTree, safeArchivePath, takeUploadSlot } = require('../server')

test.after(async () => deleteOwnedTree(store, path.dirname(store)))

test('网页包路径会拒绝目录穿越', () => {
  assert.equal(safeArchivePath('../secret.html'), '')
  assert.equal(safeArchivePath('/absolute.html'), '')
  assert.equal(safeArchivePath('folder/../secret.html'), '')
  assert.equal(safeArchivePath('folder/index.html'), 'folder/index.html')
})

test('高保真上传会按来源地址限流', () => {
  const request = { headers: {}, socket: { remoteAddress: 'rate-limit-test' } }
  for (let index = 0; index < UPLOAD_LIMIT; index += 1) {
    assert.equal(takeUploadSlot(request, 1000).allowed, true)
  }
  const blocked = takeUploadSlot(request, 1000)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfter > 0)
})

test('没有文件或扩展名不支持时会立即返回明确错误', async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const empty = await fetch(`${baseUrl}/api/documents`, { method: 'POST', body: new FormData() })
    assert.equal(empty.status, 400)
    assert.match((await empty.json()).error, /没有收到文件/)

    const form = new FormData()
    form.append('file', new Blob(['not html']), 'notes.txt')
    const unsupported = await fetch(`${baseUrl}/api/documents`, { method: 'POST', body: form })
    assert.equal(unsupported.status, 400)
    assert.match((await unsupported.json()).error, /仅支持/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('高保真服务原样托管 HTML、保留脚本并启用沙箱', async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const form = new FormData()
    const source = '<!doctype html><html><body><h1>高保真</h1><script>document.body.dataset.ready="yes"</script></body></html>'
    form.append('file', new Blob([source], { type: 'text/html' }), 'page.html')
    const upload = await fetch(`${baseUrl}/api/documents`, { method: 'POST', body: form })
    assert.equal(upload.status, 201)
    const payload = await upload.json()
    assert.match(payload.viewUrl, /^http:\/\/127\.0\.0\.1:/)

    const view = await fetch(payload.viewUrl)
    assert.equal(view.status, 200)
    assert.match(view.headers.get('content-security-policy'), /sandbox allow-scripts allow-same-origin/)
    assert.equal(view.headers.get('access-control-allow-origin'), '*')
    assert.equal(await view.text(), source)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('中文文件名会保持 UTF-8 而不是乱码', async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const form = new FormData()
    form.append('file', new Blob(['<h1>中文</h1>'], { type: 'text/html' }), '日常计算器.html')
    const upload = await fetch(`${baseUrl}/api/documents`, { method: 'POST', body: form })
    const payload = await upload.json()

    assert.equal(upload.status, 201)
    assert.match(decodeURIComponent(payload.viewUrl), /日常计算器\.html$/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('ZIP 网页包会保留入口 HTML 和相对静态资源', async () => {
  const zip = Buffer.from('UEsDBBQAAAAIAKx4DV0ZElE7UAAAAE8AAAAPAAAAc2l0ZS9pbmRleC5odG1ss1FMyU8uqSxIVcgoyc2xs8nJzMtWKErNsVUqLqnMSS3OSE0tUVLIKEpNs1VKLC5OLSnWL84sSdVLLi5WsrPJMLR7vnfiy4Vbn/a02ugDeQBQSwMEFAAAAAgArHgNXZXMossWAAAAFAAAABQAAABzaXRlL2Fzc2V0cy9zaXRlLmNzc8swrE7Oz8kvsipKT9Iw1DHSMdasBQBQSwECFAMUAAAACACseA1dGRJRO1AAAABPAAAADwAAAAAAAAAAAAAAgAEAAAAAc2l0ZS9pbmRleC5odG1sUEsBAhQDFAAAAAgArHgNXZXMossWAAAAFAAAABQAAAAAAAAAAAAAAIABfQAAAHNpdGUvYXNzZXRzL3NpdGUuY3NzUEsFBgAAAAACAAIAfwAAAMUAAAAAAA==', 'base64')
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const form = new FormData()
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'saved-page.zip')
    const upload = await fetch(`${baseUrl}/api/documents`, { method: 'POST', body: form })
    const payload = await upload.json()

    assert.equal(upload.status, 201)
    assert.match(payload.viewUrl, /\/site\/index\.html$/)
    const page = await fetch(payload.viewUrl)
    assert.match(await page.text(), /assets\/site\.css/)
    const stylesheet = await fetch(new URL('assets/site.css', payload.viewUrl))
    assert.equal(await stylesheet.text(), 'h1{color:rgb(1,2,3)}')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
