'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { inlinePoster } = require('./helpers/inline-poster')
const { verifyFileRoute } = require('../scripts/verify-interactive-poster-file-route')

test('poster file route waits for asynchronous disk writes and serialized view callbacks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-poster-route-test-'))
  const file = path.join(root, 'generated-poster.html')
  try {
    await fs.writeFile(file, inlinePoster())
    const report = await verifyFileRoute({ sourcePath: file })
    assert.ok(report.sourceBytes > 2 * 1024 * 1024)
    assert.equal(report.writes.length, 1, 'reused inline images are written once')
    assert.equal(report.controls.length, 5)
    assert.equal(report.filesRemainingAfterClose, 0)
    assert.match(report.wechat, /not verified/)
  } finally {
    await fs.unlink(file)
    await fs.rmdir(root)
  }
})
